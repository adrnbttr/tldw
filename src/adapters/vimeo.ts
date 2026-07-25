import type { DetectedVideo, Transcript, TranscriptSegment } from '@/types';
import { TldwError, buildFullText } from '@/types';
import type { Adapter } from './types';

/**
 * Vimeo adapter — level 1 only (F4).
 *
 * Degraded path is expected: on the target site the CC button is absent, which
 * suggests no text track. We still attempt level 1 (query the player config for
 * `text_tracks`) before the orchestrator falls back to audio transcription.
 */

const PREFERRED_LANGUAGES = ['fr', 'en'];

interface VimeoTextTrack {
  lang: string;
  kind?: string;
  label?: string;
  /** Relative or absolute URL to the WebVTT track. */
  url: string;
}

interface VimeoConfig {
  request?: { text_tracks?: VimeoTextTrack[] };
}

export const vimeoAdapter: Adapter = {
  provider: 'vimeo',

  canHandle(video) {
    return video.provider === 'vimeo' && !!video.externalId;
  },

  async extractCaptions(video, signal) {
    const config = await fetchPlayerConfig(video.externalId, signal);
    const tracks = config.request?.text_tracks ?? [];
    if (tracks.length === 0) {
      throw new TldwError('NO_CAPTIONS_AVAILABLE', 'No text tracks on this Vimeo video.');
    }

    const track = pickTrack(tracks);
    const segments = await fetchVtt(track.url, signal);
    if (segments.length === 0) {
      throw new TldwError('NO_CAPTIONS_AVAILABLE', 'Vimeo text track was empty.');
    }

    return normalize(video, track.lang, segments);
  },
};

async function fetchPlayerConfig(videoId: string, signal?: AbortSignal): Promise<VimeoConfig> {
  const res = await fetch(`https://player.vimeo.com/video/${videoId}/config`, {
    credentials: 'omit',
    signal,
  });
  if (!res.ok) {
    // Private/domain-restricted videos often 403 here — treat as no captions so
    // the orchestrator can drop to the audio fallback.
    throw new TldwError('NO_CAPTIONS_AVAILABLE', `Vimeo config returned ${res.status}.`);
  }
  return (await res.json()) as VimeoConfig;
}

export function pickTrack(tracks: VimeoTextTrack[]): VimeoTextTrack {
  const score = (t: VimeoTextTrack): number => {
    const idx = PREFERRED_LANGUAGES.indexOf(t.lang);
    return idx === -1 ? 0 : PREFERRED_LANGUAGES.length - idx;
  };
  return [...tracks].sort((a, b) => score(b) - score(a))[0];
}

function absoluteUrl(url: string): string {
  return url.startsWith('http') ? url : `https://player.vimeo.com${url}`;
}

async function fetchVtt(url: string, signal?: AbortSignal): Promise<TranscriptSegment[]> {
  const res = await fetch(absoluteUrl(url), { credentials: 'omit', signal });
  if (!res.ok) {
    throw new TldwError('NO_CAPTIONS_AVAILABLE', `VTT fetch returned ${res.status}.`);
  }
  return parseVtt(await res.text());
}

/** Minimal WebVTT parser: cue timing line + following text lines. */
export function parseVtt(vtt: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = vtt.replace(/\r/g, '').split('\n\n');

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timingLine = lines.find((l) => l.includes('-->'));
    if (!timingLine) continue;

    const [rawStart, rawEnd] = timingLine.split('-->').map((s) => s.trim().split(' ')[0]);
    const start = parseTimestamp(rawStart);
    const end = parseTimestamp(rawEnd);
    const text = lines
      .slice(lines.indexOf(timingLine) + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) segments.push({ start, end, text });
  }
  return segments;
}

/** Parses "HH:MM:SS.mmm" or "MM:SS.mmm" into seconds. */
export function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function normalize(
  video: DetectedVideo,
  language: string,
  segments: TranscriptSegment[],
): Transcript {
  return {
    videoId: video.id,
    source: 'vimeo_captions',
    language,
    duration: video.duration ?? segments[segments.length - 1]?.end ?? 0,
    segments,
    fullText: buildFullText(segments),
    metadata: {
      title: video.title,
      provider: 'vimeo',
      extractedAt: new Date().toISOString(),
    },
  };
}
