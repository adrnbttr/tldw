import { TldwError } from '@/types';
import type { ChunkPlan } from './chunker';
import type { ChunkTranscript } from './openrouter-audio';

/**
 * Per-chunk transcription loop of the OpenRouter path, kept free of ffmpeg and
 * fetch so it is unit-testable: extraction and transcription are injected.
 *
 * - an empty first window = no decodable audio track (typed error); a later
 *   empty window = the stream ended early → stop;
 * - a chunk transcribed as empty text (music, silence) is an empty chunk;
 *   only when EVERY transcribed chunk is empty does the job fail;
 * - a response cut by the output cap is retried once as two halves (when the
 *   chunk is long enough to split), otherwise kept and logged as truncated;
 * - a chunk failing after its retries fails the job, with a log line counting
 *   the chunks already paid for.
 */

export interface ChunkRunnerDeps {
  /** Extracts `[start, end)` as audio; null when the stream ended before it. */
  extract(start: number, end: number): Promise<Uint8Array | null>;
  transcribe(audio: Uint8Array): Promise<ChunkTranscript>;
  /** Called before each chunk (progress reporting). */
  onChunk?(chunk: ChunkPlan, total: number): void;
  log: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
  };
}

/** Below this length (seconds) a truncated chunk is not split further. */
export const MIN_SPLIT_SECONDS = 60;

/** Returns texts indexed by `chunk.index` (undefined for chunks never reached). */
export async function transcribeChunks(
  chunks: ChunkPlan[],
  deps: ChunkRunnerDeps,
): Promise<Array<string | undefined>> {
  const texts: Array<string | undefined> = [];
  let transcribed = 0;
  let empty = 0;

  for (const chunk of chunks) {
    deps.onChunk?.(chunk, chunks.length);
    const audio = await deps.extract(chunk.start, chunk.end);
    if (!audio) {
      if (chunk.index === 0) {
        throw new TldwError('AUDIO_EXTRACTION_FAILED', 'The input has no decodable audio track.');
      }
      deps.log.info('stream ended before chunk', { index: chunk.index, total: chunks.length });
      break;
    }

    let text: string;
    try {
      text = await transcribeChunk(chunk, audio, deps);
    } catch (err) {
      deps.log.warn('chunk failed, job aborted', {
        index: chunk.index,
        total: chunks.length,
        transcribed,
        empty,
        code: err instanceof TldwError ? err.code : 'UNKNOWN',
      });
      throw err;
    }
    texts[chunk.index] = text;
    transcribed++;
    if (!text.trim()) empty++;
  }

  deps.log.info('chunks transcribed', { total: chunks.length, transcribed, empty });
  if (transcribed > 0 && empty === transcribed) {
    throw new TldwError(
      'TRANSCRIPTION_API_ERROR',
      'No speech was transcribed.',
      `all ${transcribed} audio chunk(s) came back empty`,
    );
  }
  return texts;
}

async function transcribeChunk(
  chunk: ChunkPlan,
  audio: Uint8Array,
  deps: ChunkRunnerDeps,
): Promise<string> {
  const first = await deps.transcribe(audio);
  if (!first.truncated) return first.text;

  const length = chunk.end - chunk.start;
  if (length < MIN_SPLIT_SECONDS) {
    deps.log.warn('chunk transcript truncated', { index: chunk.index, seconds: length });
    return first.text;
  }

  deps.log.warn('chunk transcript truncated, retrying as two halves', { index: chunk.index });
  const mid = chunk.start + length / 2;
  const halves: string[] = [];
  for (const [start, end] of [
    [chunk.start, mid],
    [mid, chunk.end],
  ] as const) {
    const part = await deps.extract(start, end);
    if (!part) break;
    const result = await deps.transcribe(part);
    if (result.truncated) {
      deps.log.warn('chunk half still truncated', { index: chunk.index, start, end });
    }
    halves.push(result.text);
  }
  return halves.filter((h) => h.trim()).join(' ');
}
