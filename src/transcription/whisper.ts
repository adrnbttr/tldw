import type { TranscriptSegment } from '@/types';
import { TldwError } from '@/types';

/**
 * Whisper transcription client (F5.5).
 *
 * Targets the OpenAI-compatible `audio/transcriptions` endpoint. Requesting
 * `verbose_json` gives per-segment timings, which we need to reassemble chunks.
 */

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

export interface WhisperOptions {
  apiKey: string;
  /** Model id, e.g. "whisper-1". */
  model?: string;
  /** BCP-47 language hint to improve accuracy. */
  language?: string;
  signal?: AbortSignal;
}

interface VerboseJson {
  text?: string;
  language?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface WhisperResult {
  language: string;
  segments: TranscriptSegment[];
}

export async function transcribeAudio(
  audio: Blob,
  filename: string,
  options: WhisperOptions,
): Promise<WhisperResult> {
  const { apiKey, model = 'whisper-1', language, signal } = options;
  if (!apiKey) {
    throw new TldwError('MISSING_TRANSCRIPTION_KEY', 'Transcription API key is missing.');
  }

  const form = new FormData();
  form.append('file', audio, filename);
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  if (language) form.append('language', language);

  let response: globalThis.Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new TldwError('TIMEOUT', 'Transcription aborted.');
    throw new TldwError('TRANSCRIPTION_API_ERROR', 'Network error calling Whisper.', String(err));
  }

  if (response.status === 429 || response.status === 402) {
    const retry = response.headers.get('retry-after');
    throw new TldwError(
      'QUOTA_EXCEEDED',
      'Transcription quota/credits exceeded.',
      retry ? `réessayez dans ${retry}s` : undefined,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new TldwError(
      'TRANSCRIPTION_API_ERROR',
      `Whisper returned ${response.status}.`,
      body.slice(0, 300),
    );
  }

  const data = (await response.json()) as VerboseJson;
  const segments: TranscriptSegment[] = (data.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));

  return { language: data.language ?? language ?? 'fr', segments };
}
