import type { DetectedVideo, ProgressData, Settings, Transcript, TranscriptSegment } from '@/types';
import { DEFAULT_SETTINGS, TldwError, buildFullText } from '@/types';
import { capturesReady, getCapturedMedia } from '@/background/media-capture';
import { isExtensionPageSender } from '@/background/sender-guard';
import type { MediaCandidate } from './media';
import { selectSources } from './sources';
import type { SourceSelection } from './sources';
import { audioQueue, closeOffscreen, ensureOffscreen } from './offscreen-session';
import { getCatalog, isLocale } from '@/i18n';
import type {
  OffscreenProgressPhase,
  OffscreenRequest,
  OffscreenResponse,
  TranscribeJob,
} from './offscreen-protocol';

/**
 * Audio fallback (F5) — level 2 of the cascade.
 *
 * The delicate, fragile part of the project, kept strictly behind this stable
 * `Transcriber` interface so it can be swapped without touching anything else.
 * All heavy lifting happens in the offscreen document; this module only resolves
 * media sources, drives the offscreen lifecycle, and rebuilds a `Transcript`.
 *
 * NOTE: end-to-end extraction depends on a DRM-free stream and on ffmpeg.wasm
 * running under the extension CSP; it must be validated against a real target.
 */
/** `queued`: waiting behind other audio jobs (data.ahead = how many). */
export type TranscribeProgress = (
  detail: string,
  phase?: OffscreenProgressPhase | 'queued',
  data?: ProgressData,
) => void;

export interface TranscribeContext {
  /**
   * Tab the job was requested from, fixed when the request arrived: captures
   * are read from it and PRIME_MEDIA goes to it — never to whatever tab is
   * active when the job's turn comes (batch, long captions step, queue).
   */
  tabId?: number;
}

export interface Transcriber {
  transcribe(
    video: DetectedVideo,
    settings: Settings,
    onProgress: TranscribeProgress,
    signal?: AbortSignal,
    context?: TranscribeContext,
  ): Promise<Transcript>;
}

const WHISPER_MODEL = 'whisper-1';

/**
 * Download + extraction budget. The phase is watched by an inactivity timer —
 * reset on every progress message (each range block, HLS segment, or streamed
 * slice of a single download) — so a stalled host fails fast while a slow but
 * moving download is never cut off; an overall cap still bounds the phase.
 */
export const MEDIA_INACTIVITY_SECONDS = 2 * 60;
/** Floor of the overall download/extraction cap. */
const MIN_MEDIA_BUDGET_SECONDS = 10 * 60;

/** Overall download/extraction cap: the user's timeout, never below 10 min. */
export function mediaBudgetSeconds(timeoutSeconds: number): number {
  return Math.max(positiveSecondsOrZero(timeoutSeconds), MIN_MEDIA_BUDGET_SECONDS);
}

/** Hard ceiling for the transcription phase: no budget grows past 4 h. */
const MAX_TRANSCRIPTION_TIMEOUT_SECONDS = 4 * 3600;

/**
 * Timeout for the transcription phase: the user's base timeout plus one second
 * of budget per second of media (real-time pace), capped at 4 h. `baseSeconds`
 * (the `timeoutSeconds` setting, 15 min by default) stays the floor — null,
 * negative or NaN durations add nothing; an invalid base falls back to the
 * default setting rather than to 0 (which would time out instantly).
 */
export function transcriptionTimeoutSeconds(
  durationSeconds: number | null,
  baseSeconds: number,
): number {
  const duration = positiveSecondsOrZero(durationSeconds);
  const base = positiveSecondsOrZero(baseSeconds) || DEFAULT_SETTINGS.timeoutSeconds;
  return Math.min(base + duration, MAX_TRANSCRIPTION_TIMEOUT_SECONDS);
}

/** Treats null/negative/NaN as "no value" instead of poisoning the arithmetic. */
function positiveSecondsOrZero(seconds: number | null): number {
  return seconds != null && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export const audioTranscriber: Transcriber = {
  async transcribe(video, settings, onProgress, signal, context = {}) {
    // OpenRouter transcription reuses the summary key; OpenAI/Whisper needs its own.
    if (settings.transcriptionProvider === 'openrouter') {
      if (!settings.openRouterKey) {
        throw new TldwError('MISSING_OPENROUTER_KEY', 'OpenRouter API key is missing.');
      }
    } else if (!settings.transcriptionKey) {
      throw new TldwError('MISSING_TRANSCRIPTION_KEY', 'Whisper requires an OpenAI key.');
    }

    const t = getCatalog(isLocale(settings.uiLanguage) ? settings.uiLanguage : 'en').transcription;
    const { tabId } = context;

    // Sources are resolved once the slot is ours, not before queueing: signed
    // media URLs may expire while earlier jobs run.
    return audioQueue.run(
      async () => {
        const selection = await acquireSources(video, tabId, t, onProgress, signal);
        const job: TranscribeJob = {
          jobId: crypto.randomUUID(),
          videoId: video.id,
          provider: video.provider,
          title: video.title,
          duration: video.duration,
          uiLanguage: settings.uiLanguage,
          transcriptionProvider: settings.transcriptionProvider,
          openRouterKey: settings.openRouterKey,
          audioModel: settings.audioModel,
          transcriptionKey: settings.transcriptionKey,
          whisperModel: WHISPER_MODEL,
          sources: selection.sources,
        };
        const result = await runInOffscreenSlot(job, onProgress, settings.timeoutSeconds, signal);
        return normalize(video, result, selection.attributed);
      },
      {
        signal,
        onQueued: (ahead) => onProgress(t.queued, 'queued', { ahead }),
      },
    );
  },
};

/** Typed error for "nothing usable captured" (with a technical reason). */
function needsPlayback(reason: string): TldwError {
  return new TldwError(
    'MEDIA_NEEDS_PLAYBACK',
    'No media captured; the video needs to start playing.',
    reason,
  );
}

/**
 * A loose `segment` capture is a few seconds of a stream, never the whole
 * media: it may only serve as attribution evidence, not as a source.
 */
function wholeMedia(selection: SourceSelection): SourceSelection {
  return { ...selection, sources: selection.sources.filter((s) => s.kind !== 'segment') };
}

/**
 * Sources for the requested video, read from the job's own tab. When nothing
 * whole was captured (nothing at all, or only segments — the manifest was
 * requested before this worker existed or the captures were cleared), the
 * video is primed once in that tab and the captures re-read. Still nothing
 * whole → typed MEDIA_NEEDS_PLAYBACK, never a 6-second "transcript".
 */
async function acquireSources(
  video: DetectedVideo,
  tabId: number | undefined,
  t: ReturnType<typeof getCatalog>['transcription'],
  onProgress: TranscribeProgress,
  signal?: AbortSignal,
): Promise<SourceSelection> {
  await capturesReady();
  let selection = await resolveSources(video, tabId, signal);
  if (wholeMedia(selection).sources.length > 0) return wholeMedia(selection);

  if (tabId == null) throw needsPlayback('No tab is associated with this job.');
  if (!(await tabExists(tabId))) {
    throw needsPlayback('The tab the job was started from is no longer open.');
  }
  // Nothing whole captured yet — nudge the page to start the video, then re-check.
  onProgress(t.fetchingMedia, 'download');
  await primeAndWait(video, tabId, signal);
  selection = await resolveSources(video, tabId, signal);
  const whole = wholeMedia(selection);
  if (whole.sources.length > 0) return whole;
  if (selection.sources.length > 0) {
    throw needsPlayback(
      'Only isolated media segments were captured (the stream manifest was missed); reload the page and play the video.',
    );
  }
  throw needsPlayback('No media request was captured in the tab.');
}

async function tabExists(tabId: number): Promise<boolean> {
  try {
    return (await chrome.tabs.get(tabId)) != null;
  } catch {
    return false;
  }
}

/** What the offscreen document reports for a successful run. */
interface OffscreenOutcome {
  language?: string;
  segments: TranscriptSegment[];
  /** The media covered clearly less than the expected duration. */
  partial?: boolean;
}

/**
 * One audio job holding the queue slot: opens the offscreen document, runs the
 * job, then closes the document if the queue is empty — or unconditionally if
 * the run ended without the offscreen side reporting (cancel, timeout,
 * unreachable): closing is what stops work the worker no longer waits for.
 */
async function runInOffscreenSlot(
  job: TranscribeJob,
  onProgress: TranscribeProgress,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<OffscreenOutcome> {
  const status = { reported: false };
  try {
    await ensureOffscreen();
    return await runInOffscreen(job, onProgress, timeoutSeconds, signal, status);
  } finally {
    if (!status.reported || audioQueue.size <= 1) await closeOffscreen();
  }
}

/**
 * Asks the page (in the job's own tab) to briefly play the video, then waits
 * for capture to happen. Aborts as soon as `signal` does (typed TIMEOUT
 * "cancelled", like every other cancellation point).
 */
export async function primeAndWait(
  video: DetectedVideo,
  tabId: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfCancelled(signal);
  try {
    // A native <video> lives in exactly one frame: target it. Embeds (postMessage
    // to the iframe from its parent), Drive (player frame found by URL) and a
    // hosted-player placeholder (a parent's Wistia/Loom… `<iframe>`, primed by
    // the player frame of that identity) are broadcast to every frame, each
    // deciding for itself.
    const options =
      video.provider === 'native' && video.frameId != null && !video.iframeSrc
        ? { frameId: video.frameId }
        : {};
    await chrome.tabs.sendMessage(tabId, { type: 'PRIME_MEDIA', video }, options);
  } catch {
    // No content script on this page — nothing to do.
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, PRIME_WAIT_MS);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** How long a primed video gets to issue its media requests. */
const PRIME_WAIT_MS = 5000;

function cancelled(): TldwError {
  return new TldwError('TIMEOUT', 'Transcription cancelled.');
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

/** Candidate media sources for the requested video (see ./sources.ts). */
async function resolveSources(
  video: DetectedVideo,
  tabId?: number,
  signal?: AbortSignal,
): Promise<SourceSelection> {
  const vimeo =
    video.provider === 'vimeo' && video.externalId && !video.mediaSrc
      ? await vimeoSources(video.externalId, signal)
      : [];
  const captured = tabId != null ? getCapturedMedia(tabId) : [];
  return selectSources(video, captured, vimeo);
}

interface VimeoFiles {
  request?: {
    files?: {
      progressive?: Array<{ url: string; width?: number }>;
      hls?: { cdns?: Record<string, { url?: string }>; default_cdn?: string };
    };
  };
}

/** Bound of the Vimeo player-config lookup (a stalled host must not pin the job). */
export const VIMEO_CONFIG_TIMEOUT_MS = 8000;

/**
 * Media sources from Vimeo's player config — best effort: any failure, the
 * job's cancel (`signal`) or {@link VIMEO_CONFIG_TIMEOUT_MS} yields no source.
 */
export async function vimeoSources(
  externalId: string,
  signal?: AbortSignal,
): Promise<MediaCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VIMEO_CONFIG_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(`https://player.vimeo.com/video/${externalId}/config`, {
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const config = (await res.json()) as VimeoFiles;
    const out: MediaCandidate[] = [];

    const progressive = config.request?.files?.progressive ?? [];
    // Highest resolution first — the audio track is the same, but pick a real URL.
    const best = [...progressive].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
    if (best?.url) out.push({ url: best.url, kind: 'progressive' });

    const hls = config.request?.files?.hls;
    const cdn = hls?.default_cdn && hls.cdns ? hls.cdns[hls.default_cdn] : undefined;
    if (cdn?.url) out.push({ url: cdn.url, kind: 'hls' });

    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Drives one offscreen job, matched on its per-run `jobId`.
 *
 * Download + extraction run under an inactivity timer (`MEDIA_INACTIVITY_SECONDS`,
 * re-armed by every progress message) plus an overall cap
 * (`mediaBudgetSeconds`); entering the transcription phase swaps both for a
 * duration-proportional budget (`transcriptionTimeoutSeconds`). `status.reported`
 * is set once the offscreen side delivered its terminal result.
 */
export function runInOffscreen(
  job: TranscribeJob,
  onProgress: TranscribeProgress,
  timeoutSeconds: number,
  signal?: AbortSignal,
  status: { reported: boolean } = { reported: false },
): Promise<OffscreenOutcome> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TldwError('TIMEOUT', 'Transcription cancelled.'));
      return;
    }

    // Download + extraction first: overall cap (plus the inactivity timer, armed below).
    const capTimer = setTimeout(
      () => fail(new TldwError('TIMEOUT', 'Media download or extraction exceeded the time limit.')),
      mediaBudgetSeconds(timeoutSeconds) * 1000,
    );
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let transcribeTimer: ReturnType<typeof setTimeout> | undefined;
    let transcribing = false;

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(capTimer);
      clearTimeout(idleTimer);
      clearTimeout(transcribeTimer);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (err: TldwError) => {
      cleanup();
      reject(err);
    };

    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => fail(new TldwError('TIMEOUT', 'Media download or extraction stalled.')),
        MEDIA_INACTIVITY_SECONDS * 1000,
      );
    };

    const listener = (msg: OffscreenResponse, sender?: chrome.runtime.MessageSender) => {
      // Only the offscreen document (an extension page) reports runs; the
      // per-run random jobId is the second key.
      if (!isExtensionPageSender(sender, chrome.runtime.id)) return;
      if (!msg || !('jobId' in msg) || msg.jobId !== job.jobId) return;
      if (msg.type === 'OFFSCREEN_PROGRESS') {
        onProgress(msg.detail, msg.phase, msg.data);
        if (msg.phase === 'transcribe') {
          // Switching to transcription swaps the media budget for one
          // proportional to the now-resolved media duration — armed once.
          if (!transcribing) {
            transcribing = true;
            clearTimeout(capTimer);
            clearTimeout(idleTimer);
            transcribeTimer = setTimeout(
              () => fail(new TldwError('TIMEOUT', 'Transcription exceeded the time limit.')),
              transcriptionTimeoutSeconds(msg.duration ?? null, timeoutSeconds) * 1000,
            );
          }
        } else if (!transcribing) {
          armIdle();
        }
        return;
      }
      if (msg.type === 'OFFSCREEN_RESULT') {
        status.reported = true;
        cleanup();
        if (msg.ok) {
          resolve({ language: msg.language, segments: msg.segments, partial: msg.partial });
        }
        // msg.message carries the technical detail → keep it as providerMessage;
        // retryAfter crosses the boundary so a 429's wait still reaches the popup.
        else reject(new TldwError(msg.code, 'audio fallback failed', msg.message, msg.retryAfter));
      }
    };

    const onAbort = () => fail(new TldwError('TIMEOUT', 'Transcription cancelled.'));

    armIdle();

    chrome.runtime.onMessage.addListener(listener);
    signal?.addEventListener('abort', onAbort);

    const request: OffscreenRequest = { type: 'OFFSCREEN_TRANSCRIBE', job };
    chrome.runtime.sendMessage(request).catch((err) => {
      fail(
        new TldwError('AUDIO_EXTRACTION_FAILED', 'Offscreen document unreachable.', String(err)),
      );
    });
  });
}

/** BCP-47 "undetermined": the provider did not report the spoken language. */
const UNDETERMINED_LANGUAGE = 'und';

function normalize(
  video: DetectedVideo,
  { language, segments, partial }: OffscreenOutcome,
  attributed: boolean,
): Transcript {
  if (segments.length === 0) {
    throw new TldwError('TRANSCRIPTION_API_ERROR', 'Transcription returned no text.');
  }
  return {
    videoId: video.id,
    source: 'audio_transcription',
    language: language || UNDETERMINED_LANGUAGE,
    duration: video.duration ?? segments[segments.length - 1]?.end ?? 0,
    segments,
    fullText: buildFullText(segments),
    metadata: {
      title: video.title,
      provider: video.provider,
      extractedAt: new Date().toISOString(),
      ...(attributed ? {} : { sourceAttributed: false }),
      ...(partial ? { partial: true } : {}),
    },
  };
}
