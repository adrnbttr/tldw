import type { TranscriptSegment } from '@/types';
import { TldwError, messageFor } from '@/types';
import type {
  OffscreenRequest,
  OffscreenResponse,
  TranscribeJob,
} from '@/transcription/offscreen-protocol';
import { pickBestCandidate, resolveSegmentUrls } from '@/transcription/media';
import { FfmpegAudio, AUDIO_BYTES_PER_SECOND } from '@/transcription/audio';
import { planChunks, mergeChunkTranscripts } from '@/transcription/chunker';
import { transcribeAudio } from '@/transcription/whisper';

/**
 * Offscreen document (F5).
 *
 * Runs the full audio-fallback pipeline off the service worker:
 *   resolve media source → download → extract mono MP3 → chunk → Whisper → merge.
 * Progress and the terminal result are posted back to the worker.
 */

const audio = new FfmpegAudio();

chrome.runtime.onMessage.addListener((message: OffscreenRequest) => {
  if (message.type === 'OFFSCREEN_TRANSCRIBE') {
    void runJob(message.job);
  }
  return false;
});

function report(msg: OffscreenResponse): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* worker gone — nothing to do */
  });
}

async function runJob(job: TranscribeJob): Promise<void> {
  const progress = (detail: string) =>
    report({ type: 'OFFSCREEN_PROGRESS', videoId: job.videoId, detail });

  try {
    const mediaBytes = await downloadSource(job, progress);

    progress('Extraction de la piste audio…');
    const mp3 = await audio.toMonoMp3(mediaBytes, 'input.media');

    const duration = job.duration ?? estimateDuration(mp3.byteLength);
    const chunks = planChunks({
      durationSeconds: duration,
      bytesPerSecond: AUDIO_BYTES_PER_SECOND,
    });

    const perChunkSegments: TranscriptSegment[][] = [];
    const offsets: number[] = [];
    let language = job.language;

    for (const chunk of chunks) {
      progress(`Transcription ${chunk.index + 1}/${chunks.length} (${formatClock(chunk.start)})…`);
      const slice = chunks.length === 1 ? mp3 : await audio.slice(mp3, chunk.start, chunk.end);
      const result = await transcribeAudio(
        new Blob([slice as BlobPart]),
        `chunk-${chunk.index}.mp3`,
        {
          apiKey: job.transcriptionKey,
          model: job.whisperModel,
          language: job.language,
        },
      );
      language = result.language || language;
      perChunkSegments.push(result.segments);
      offsets.push(chunk.start);
    }

    const segments = mergeChunkTranscripts(perChunkSegments, offsets);
    audio.terminate();

    report({ type: 'OFFSCREEN_RESULT', videoId: job.videoId, ok: true, language, segments });
  } catch (err) {
    audio.terminate();
    const code = err instanceof TldwError ? err.code : 'UNKNOWN';
    report({
      type: 'OFFSCREEN_RESULT',
      videoId: job.videoId,
      ok: false,
      code,
      message: messageFor(err),
    });
  }
}

/** Resolves and downloads the best media source into a single byte buffer. */
async function downloadSource(
  job: TranscribeJob,
  progress: (detail: string) => void,
): Promise<Uint8Array> {
  const best = pickBestCandidate(job.sources);
  if (!best) {
    throw new TldwError('MEDIA_NOT_CAPTURABLE', 'No media source was captured.');
  }

  progress('Récupération du flux média…');

  if (best.kind === 'progressive' || best.kind === 'segment') {
    return fetchBytes(best.url);
  }

  if (best.kind === 'hls') {
    const playlist = await (await fetchAuth(best.url)).text();
    const segmentUrls = resolveSegmentUrls(playlist, best.url);
    if (segmentUrls.length === 0) {
      throw new TldwError('MEDIA_NOT_CAPTURABLE', 'HLS playlist had no segments.');
    }
    const parts: Uint8Array[] = [];
    for (let i = 0; i < segmentUrls.length; i++) {
      progress(`Assemblage des segments (${i + 1}/${segmentUrls.length})…`);
      parts.push(await fetchBytes(segmentUrls[i]));
    }
    return concat(parts);
  }

  // DASH and anything else are not assembled here.
  throw new TldwError('MEDIA_NOT_CAPTURABLE', `Unsupported media kind: ${best.kind}.`);
}

async function fetchAuth(url: string): Promise<Response> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      throw new TldwError('MEDIA_PROTECTED', `Media request returned ${res.status}.`);
    }
    throw new TldwError('MEDIA_NOT_CAPTURABLE', `Media request returned ${res.status}.`);
  }
  return res;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetchAuth(url)).arrayBuffer());
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function estimateDuration(byteLength: number): number {
  return Math.max(1, Math.round(byteLength / AUDIO_BYTES_PER_SECOND));
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
