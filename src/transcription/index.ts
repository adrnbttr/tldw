import type { DetectedVideo, Settings, Transcript, TranscriptSegment } from '@/types';
import { TldwError, buildFullText } from '@/types';
import { getCapturedMedia } from '@/background/media-capture';
import type { MediaCandidate } from './media';
import { classifyMedia } from './media';
import { getCatalog, isLocale } from '@/i18n';
import type {
  OffscreenProgressPhase,
  OffscreenRequest,
  OffscreenResponse,
  TranscribeJob,
} from './offscreen-protocol';
import { OFFSCREEN_PATH } from './offscreen-protocol';

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
export interface Transcriber {
  transcribe(
    video: DetectedVideo,
    settings: Settings,
    onProgress: (detail: string, phase?: OffscreenProgressPhase) => void,
    signal?: AbortSignal,
  ): Promise<Transcript>;
}

const WHISPER_MODEL = 'whisper-1';

/**
 * Fixed budget for the download + extraction phase, independent of media
 * length: fetching bytes and probing the container should not grow with the
 * video, and a stalled host must fail within it.
 */
export const MEDIA_TIMEOUT_SECONDS = 10 * 60;

/** Hard ceiling for the transcription phase: no budget grows past 4 h. */
const MAX_TRANSCRIPTION_TIMEOUT_SECONDS = 4 * 3600;

/**
 * Timeout for the transcription phase: the user's base timeout plus one second
 * of budget per second of media (real-time pace), capped at 4 h. `baseSeconds`
 * (the `timeoutSeconds` setting, 15 min by default) stays the floor — null,
 * negative or NaN durations add nothing; negative/NaN bases count as 0.
 */
export function transcriptionTimeoutSeconds(
  durationSeconds: number | null,
  baseSeconds: number,
): number {
  const duration = positiveSecondsOrZero(durationSeconds);
  const base = positiveSecondsOrZero(baseSeconds);
  return Math.min(base + duration, MAX_TRANSCRIPTION_TIMEOUT_SECONDS);
}

/** Treats null/negative/NaN as "no value" instead of poisoning the arithmetic. */
function positiveSecondsOrZero(seconds: number | null): number {
  return seconds != null && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export const audioTranscriber: Transcriber = {
  async transcribe(video, settings, onProgress, signal) {
    // OpenRouter transcription reuses the summary key; OpenAI/Whisper needs its own.
    if (settings.transcriptionProvider === 'openrouter') {
      if (!settings.openRouterKey) {
        throw new TldwError('MISSING_OPENROUTER_KEY', 'OpenRouter API key is missing.');
      }
    } else if (!settings.transcriptionKey) {
      throw new TldwError('MISSING_TRANSCRIPTION_KEY', 'Whisper requires an OpenAI key.');
    }

    let sources = await resolveSources(video);
    if (sources.length === 0) {
      // Nothing captured yet — nudge the page to start the video, then re-check.
      const loc = isLocale(settings.uiLanguage) ? settings.uiLanguage : 'en';
      onProgress(getCatalog(loc).transcription.fetchingMedia, 'download');
      await primeAndWait(video);
      sources = await resolveSources(video);
    }
    if (sources.length === 0) {
      throw new TldwError(
        'MEDIA_NEEDS_PLAYBACK',
        'No media captured; the video needs to start playing.',
      );
    }

    await ensureOffscreen();

    const job: TranscribeJob = {
      videoId: video.id,
      provider: video.provider,
      title: video.title,
      duration: video.duration,
      language: settings.outputLanguage,
      uiLanguage: settings.uiLanguage,
      transcriptionProvider: settings.transcriptionProvider,
      openRouterKey: settings.openRouterKey,
      audioModel: settings.audioModel,
      transcriptionKey: settings.transcriptionKey,
      whisperModel: WHISPER_MODEL,
      sources,
    };

    const { language, segments } = await runInOffscreen(
      job,
      onProgress,
      settings.timeoutSeconds,
      signal,
    );

    return normalize(video, language, segments);
  },
};

/** Asks the page to briefly play the video, then waits for capture to happen. */
async function primeAndWait(video: DetectedVideo): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'PRIME_MEDIA', video });
  } catch {
    // No content script on this page — nothing to do.
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

/** Collects candidate media sources: Vimeo progressive/HLS + captured requests. */
async function resolveSources(video: DetectedVideo): Promise<MediaCandidate[]> {
  const sources: MediaCandidate[] = [];

  // A native <video>'s own direct URL is the most reliable source.
  if (video.mediaSrc) {
    sources.push({ url: video.mediaSrc, kind: classifyMedia(video.mediaSrc) });
  }

  if (video.provider === 'vimeo' && video.externalId) {
    sources.push(...(await vimeoSources(video.externalId)));
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) sources.push(...getCapturedMedia(tab.id));

  // De-duplicate by URL.
  const seen = new Set<string>();
  return sources.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}

interface VimeoFiles {
  request?: {
    files?: {
      progressive?: Array<{ url: string; width?: number }>;
      hls?: { cdns?: Record<string, { url?: string }>; default_cdn?: string };
    };
  };
}

async function vimeoSources(externalId: string): Promise<MediaCandidate[]> {
  try {
    const res = await fetch(`https://player.vimeo.com/video/${externalId}/config`, {
      credentials: 'omit',
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
  }
}

async function ensureOffscreen(): Promise<void> {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Run ffmpeg.wasm to extract audio for transcription.',
  });
}

/**
 * Drives one offscreen job. Download + extraction run under the fixed
 * `MEDIA_TIMEOUT_SECONDS` budget; entering the transcription phase re-arms the
 * timer with a duration-proportional budget (`transcriptionTimeoutSeconds`).
 */
function runInOffscreen(
  job: TranscribeJob,
  onProgress: (detail: string, phase?: OffscreenProgressPhase) => void,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<{ language: string; segments: TranscriptSegment[] }> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    // Last phase reported, so the transcription budget is armed exactly once,
    // at the download/extract → transcribe transition.
    let lastPhase: OffscreenProgressPhase | undefined;

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      void chrome.offscreen.closeDocument().catch(() => {});
    };

    const onTimeout = () => {
      cleanup();
      reject(
        new TldwError(
          'TIMEOUT',
          lastPhase === 'transcribe'
            ? 'Transcription exceeded the time limit.'
            : 'Media download or extraction exceeded the time limit.',
        ),
      );
    };

    const listener = (msg: OffscreenResponse) => {
      if (!('videoId' in msg) || msg.videoId !== job.videoId) return;
      if (msg.type === 'OFFSCREEN_PROGRESS') {
        onProgress(msg.detail, msg.phase);
        // Switching to transcription swaps the fixed media budget for one
        // proportional to the now-resolved media duration.
        if (msg.phase === 'transcribe' && lastPhase !== 'transcribe') {
          clearTimeout(timer);
          timer = setTimeout(
            onTimeout,
            transcriptionTimeoutSeconds(msg.duration ?? null, timeoutSeconds) * 1000,
          );
        }
        lastPhase = msg.phase;
        return;
      }
      if (msg.type === 'OFFSCREEN_RESULT') {
        cleanup();
        if (msg.ok) resolve({ language: msg.language, segments: msg.segments });
        // msg.message carries the technical detail → keep it as providerMessage.
        else reject(new TldwError(msg.code, 'audio fallback failed', msg.message));
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new TldwError('TIMEOUT', 'Transcription cancelled.'));
    };

    // Download + extraction first, under the fixed media budget.
    timer = setTimeout(onTimeout, MEDIA_TIMEOUT_SECONDS * 1000);

    chrome.runtime.onMessage.addListener(listener);
    signal?.addEventListener('abort', onAbort);

    const request: OffscreenRequest = { type: 'OFFSCREEN_TRANSCRIBE', job };
    chrome.runtime.sendMessage(request).catch((err) => {
      cleanup();
      reject(
        new TldwError('AUDIO_EXTRACTION_FAILED', 'Offscreen document unreachable.', String(err)),
      );
    });
  });
}

function normalize(
  video: DetectedVideo,
  language: string,
  segments: TranscriptSegment[],
): Transcript {
  if (segments.length === 0) {
    throw new TldwError('TRANSCRIPTION_API_ERROR', 'Transcription returned no text.');
  }
  return {
    videoId: video.id,
    source: 'audio_transcription',
    language,
    duration: video.duration ?? segments[segments.length - 1]?.end ?? 0,
    segments,
    fullText: buildFullText(segments),
    metadata: {
      title: video.title,
      provider: video.provider,
      extractedAt: new Date().toISOString(),
    },
  };
}
