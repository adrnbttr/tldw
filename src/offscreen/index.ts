import type { TranscriptSegment } from '@/types';
import { TldwError } from '@/types';
import type {
  OffscreenRequest,
  OffscreenResponse,
  TranscribeJob,
} from '@/transcription/offscreen-protocol';
import { FfmpegAudio, AUDIO_BYTES_PER_SECOND, planAudioWindows } from '@/transcription/audio';
import type { AudioWindow } from '@/transcription/audio';
import { assembleChunkSegments, mergeChunkTranscripts, planChunks } from '@/transcription/chunker';
import { transcribeChunks } from '@/transcription/chunk-runner';
import { isPartialMedia, planningDuration } from '@/transcription/coverage';
import { transcribeAudio } from '@/transcription/whisper';
import { transcribeViaOpenRouter } from '@/transcription/openrouter-audio';
import { createClientLogger } from '@/shared/logger-client';
import { getCatalog, isLocale } from '@/i18n';
import type { Messages } from '@/i18n';
import { downloadSource, safePath } from './download';
import type { ProgressFn } from './download';
import { openWorkerLink } from './worker-link';
import { isServiceWorkerSender } from '@/background/sender-guard';

/**
 * Offscreen document (F5).
 *
 * Runs the full audio-fallback pipeline off the service worker:
 *   resolve media source → download → load into ffmpeg → extract per-window
 *   mono MP3 → transcribe → merge.
 * Transcription uses OpenRouter (Gemini) by default, or OpenAI Whisper. Progress
 * and the terminal result are posted back to the worker, keyed by the run's
 * `jobId`.
 *
 * One job at a time: the worker queues audio jobs, and a job holds a port to
 * the worker for its whole duration (./worker-link.ts) — an abort as soon as
 * the worker goes away.
 */

const audio = new FfmpegAudio();

/** Offscreen logger — ships to the worker's buffer and echoes to DevTools. */
const log = createClientLogger('offscreen', { echo: true });

/** The job in flight, so a newer request (or a lost worker) can abort it. */
let current: { jobId: string; controller: AbortController; done: Promise<void> } | null = null;

let swUrl: Promise<string | undefined> | null = null;

/**
 * URL of this extension's service worker script (the built manifest's entry,
 * e.g. crxjs's `service-worker-loader.js` — what Chrome reports as the
 * worker's `sender.url`). An offscreen document only gets a subset of
 * `chrome.runtime` (no `getManifest`), so the manifest is read as a file of
 * our own origin; memoized. Unreadable → undefined (the sender check then
 * only accepts a sender without URL).
 */
function serviceWorkerUrl(): Promise<string | undefined> {
  swUrl ??= fetch(chrome.runtime.getURL('manifest.json'))
    .then((res) => res.json() as Promise<chrome.runtime.Manifest>)
    .then((manifest) => {
      const background = manifest.background;
      const path = background && 'service_worker' in background ? background.service_worker : '';
      return path ? chrome.runtime.getURL(path) : undefined;
    })
    .catch(() => undefined);
  return swUrl;
}

chrome.runtime.onMessage.addListener((message: OffscreenRequest, sender) => {
  // Only the service worker drives this document: a job carries API keys and
  // media URLs to fetch — never accepted from a content script or a page.
  if (message?.type === 'OFFSCREEN_TRANSCRIBE') {
    const { job } = message;
    void serviceWorkerUrl().then((url) => {
      if (!isServiceWorkerSender(sender, chrome.runtime.id, url)) {
        log.warn('offscreen request refused: not from the service worker');
        return;
      }
      return startJob(job);
    });
  }
  return false;
});

async function startJob(job: TranscribeJob): Promise<void> {
  // The worker serializes jobs, so anything still running here is stale (its
  // worker died or gave up on it): abort it and let it unwind first — it
  // shares the single ffmpeg instance.
  const previous = current;
  if (previous) {
    log.warn('stale offscreen job aborted', { jobId: previous.jobId });
    previous.controller.abort();
    await previous.done;
  }

  const controller = new AbortController();
  const link = openWorkerLink(() => {
    log.warn('worker link lost, aborting job', { jobId: job.jobId });
    controller.abort();
  });
  const done = runJob(job, controller.signal).finally(() => {
    link.close();
    if (current?.jobId === job.jobId) current = null;
  });
  current = { jobId: job.jobId, controller, done };
  await done;
}

function report(msg: OffscreenResponse): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* worker gone — nothing to do */
  });
}

async function runJob(job: TranscribeJob, signal: AbortSignal): Promise<void> {
  const t = getCatalog(isLocale(job.uiLanguage) ? job.uiLanguage : 'en').transcription;
  const progress: ProgressFn = (phase, detail, duration, data) =>
    report({ type: 'OFFSCREEN_PROGRESS', jobId: job.jobId, phase, detail, duration, data });
  const diag: string[] = [];
  // An abort must also stop ffmpeg mid-exec: terminating the worker rejects
  // whatever command is pending.
  const onAbort = () => audio.terminate();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    let mediaBytes: Uint8Array | null = await downloadSource(job, {
      t,
      progress,
      diag,
      signal,
    });
    log.info('media downloaded', { bytes: mediaBytes.byteLength });
    throwIfAborted(signal);

    progress('extract', t.extractingAudio);
    const source = await audio.writeSource(mediaBytes);
    mediaBytes = null; // transferred to the ffmpeg worker — drop our reference.
    const probed = await audio.probeDuration(source);
    const duration = planningDuration(job.duration, probed);
    const partial = isPartialMedia(probed, job.duration);
    if (partial) {
      log.warn('media shorter than the video, transcript will be partial', {
        probedSeconds: probed,
        expectedSeconds: job.duration,
      });
    }

    const { language, segments } =
      job.transcriptionProvider === 'openrouter'
        ? await transcribeWithOpenRouter(job, source, duration, t, progress, signal)
        : await transcribeWithWhisper(job, source, duration, t, progress, signal);

    await audio.removeSource();
    audio.terminate();
    report({
      type: 'OFFSCREEN_RESULT',
      jobId: job.jobId,
      ok: true,
      language,
      segments,
      ...(partial ? { partial: true } : {}),
    });
  } catch (err) {
    audio.terminate();
    if (signal.aborted) {
      // Nobody waits for this result any more (worker gone or job replaced).
      log.info('offscreen job aborted', { jobId: job.jobId });
      return;
    }
    const code = err instanceof TldwError ? err.code : 'UNKNOWN';
    // Carry the technical detail (ffmpeg/API) + source diagnostics so the popup
    // can show exactly what the host served.
    const base = err instanceof TldwError ? (err.providerMessage ?? '') : String(err);
    const detail = [diag.join(' '), base].filter(Boolean).join(' ‹ ');
    log.error('audio fallback failed', {
      code,
      detail,
      sourceCount: job.sources.length,
      hosts: [...new Set(job.sources.map((s) => safePath(s.url).split('/')[0]))],
    });
    const retryAfter = err instanceof TldwError ? err.retryAfter : undefined;
    report({
      type: 'OFFSCREEN_RESULT',
      jobId: job.jobId,
      ok: false,
      code,
      message: detail,
      ...(retryAfter != null ? { retryAfter } : {}),
    });
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TldwError('TIMEOUT', 'Transcription aborted.');
}

interface TranscriptResult {
  /** Detected spoken language, when the provider reports one. */
  language?: string;
  segments: TranscriptSegment[];
}

/** OpenRouter (Gemini) path: plain-text transcript, no overlap, one segment/chunk. */
async function transcribeWithOpenRouter(
  job: TranscribeJob,
  source: string,
  duration: number,
  t: Messages['transcription'],
  progress: ProgressFn,
  signal: AbortSignal,
): Promise<TranscriptResult> {
  const chunks = planChunks({
    durationSeconds: duration,
    bytesPerSecond: AUDIO_BYTES_PER_SECOND,
    overlapSeconds: 0,
  });

  // Index-addressed texts: chunk completion order (even concurrent) cannot
  // reorder the transcript.
  const texts = await transcribeChunks(chunks, {
    onChunk: (chunk, total) =>
      progress(
        'transcribe',
        total === 1
          ? t.transcribingOne
          : t.transcribing(chunk.index + 1, total, formatClock(chunk.start)),
        duration,
        { done: chunk.start, total: duration, until: chunk.end, unit: 'seconds' },
      ),
    extract: (start, end) => {
      throwIfAborted(signal);
      return audio.extractWindow(source, start, end);
    },
    transcribe: (mp3) =>
      transcribeViaOpenRouter(mp3, {
        apiKey: job.openRouterKey,
        model: job.audioModel,
        signal,
      }),
    log,
  });

  // Gemini returns plain text: no detected language to report.
  return { segments: assembleChunkSegments(chunks, texts) };
}

/** OpenAI Whisper path: per-segment timings, overlap, reassembled + de-duplicated. */
async function transcribeWithWhisper(
  job: TranscribeJob,
  source: string,
  duration: number,
  t: Messages['transcription'],
  progress: ProgressFn,
  signal: AbortSignal,
): Promise<TranscriptResult> {
  const windows = planAudioWindows({
    durationSeconds: duration,
    bytesPerSecond: AUDIO_BYTES_PER_SECOND,
  });

  const perWindowSegments: TranscriptSegment[][] = [];
  const offsets: number[] = [];
  let language: string | undefined;

  for (const window of windows) {
    progress(
      'transcribe',
      windows.length === 1
        ? t.transcribingOne
        : t.transcribing(window.index + 1, windows.length, formatClock(window.start)),
      duration,
      { done: window.start, total: duration, until: window.end, unit: 'seconds' },
    );
    throwIfAborted(signal);
    const mp3 = await extractAudioWindow(source, window);
    if (!mp3) break;
    // No language forced: Whisper detects the spoken one and reports it.
    const result = await transcribeAudio(
      new Blob([mp3 as BlobPart]),
      `window-${window.index}.mp3`,
      {
        apiKey: job.transcriptionKey,
        model: job.whisperModel,
        signal,
      },
    );
    language = result.language || language;
    perWindowSegments.push(result.segments);
    offsets.push(window.start);
  }

  return { language, segments: mergeChunkTranscripts(perWindowSegments, offsets) };
}

/**
 * Extracts one window of the source audio. An empty first window means the
 * media has no decodable audio track (typed error); a later empty window means
 * the stream ended (null → the caller stops the loop).
 */
async function extractAudioWindow(source: string, window: AudioWindow): Promise<Uint8Array | null> {
  const mp3 = await audio.extractWindow(source, window.start, window.end);
  if (!mp3 && window.index === 0) {
    throw new TldwError('AUDIO_EXTRACTION_FAILED', 'The input has no decodable audio track.');
  }
  return mp3;
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
