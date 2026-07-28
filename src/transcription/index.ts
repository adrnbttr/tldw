import type { DetectedVideo, Settings, Transcript, TranscriptSegment } from '@/types';
import { TldwError, buildFullText } from '@/types';
import { getCapturedMedia } from '@/background/media-capture';
import type { MediaCandidate } from './media';
import { classifyMedia } from './media';
import { getCatalog, isLocale } from '@/i18n';
import type { OffscreenRequest, OffscreenResponse, TranscribeJob } from './offscreen-protocol';
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
    onProgress: (detail: string) => void,
    signal?: AbortSignal,
  ): Promise<Transcript>;
}

const WHISPER_MODEL = 'whisper-1';

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
      onProgress(getCatalog(loc).transcription.fetchingMedia);
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

function runInOffscreen(
  job: TranscribeJob,
  onProgress: (detail: string) => void,
  timeoutSeconds: number,
  signal?: AbortSignal,
): Promise<{ language: string; segments: TranscriptSegment[] }> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      void chrome.offscreen.closeDocument().catch(() => {});
    };

    const listener = (msg: OffscreenResponse) => {
      if (!('videoId' in msg) || msg.videoId !== job.videoId) return;
      if (msg.type === 'OFFSCREEN_PROGRESS') {
        onProgress(msg.detail);
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

    const timer = setTimeout(() => {
      cleanup();
      reject(new TldwError('TIMEOUT', 'Transcription exceeded the time limit.'));
    }, timeoutSeconds * 1000);

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
