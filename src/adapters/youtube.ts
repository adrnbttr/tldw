import type { DetectedVideo, Transcript, TranscriptSegment } from '@/types';
import { TldwError, buildFullText } from '@/types';
import type { Adapter } from './types';

/**
 * YouTube adapter — nominal path (F3).
 *
 * YouTube generates automatic captions on nearly every video, so reliability is
 * high. We read the watch page's `ytInitialPlayerResponse`, list the caption
 * tracks, pick one by priority, then fetch the track in `json3` format.
 */

const PREFERRED_LANGUAGES = ['fr', 'en'];

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" for automatic speech recognition
  name?: { simpleText?: string };
}

export const youtubeAdapter: Adapter = {
  provider: 'youtube',

  canHandle(video) {
    return video.provider === 'youtube' && !!video.externalId;
  },

  async extractCaptions(video, signal) {
    const tracks = await fetchCaptionTracks(video.externalId, signal);
    if (tracks.length === 0) {
      throw new TldwError('NO_CAPTIONS_AVAILABLE', 'No caption tracks for this video.');
    }

    const track = pickTrack(tracks);
    const segments = await fetchTrackSegments(track, signal);
    if (segments.length === 0) {
      throw new TldwError('NO_CAPTIONS_AVAILABLE', 'Caption track was empty.');
    }

    return normalize(video, track.languageCode, segments);
  },
};

// Public "WEB" InnerTube key — stable and used by the site itself.
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

async function fetchCaptionTracks(videoId: string, signal?: AbortSignal): Promise<CaptionTrack[]> {
  // InnerTube first (reliable JSON API), then scrape the watch page as a fallback.
  const viaApi = await fetchViaInnertube(videoId, signal).catch(() => []);
  if (viaApi.length > 0) return viaApi;
  return fetchViaWatchPage(videoId, signal).catch(() => []);
}

/** YouTube's internal player API — avoids the fragile HTML scrape / consent wall. */
async function fetchViaInnertube(videoId: string, signal?: AbortSignal): Promise<CaptionTrack[]> {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({
      videoId,
      context: {
        client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en' },
      },
    }),
    signal,
  });
  if (!res.ok) return [];
  const data = (await res.json()) as PlayerResponse;
  return data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

async function fetchViaWatchPage(videoId: string, signal?: AbortSignal): Promise<CaptionTrack[]> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    credentials: 'omit',
    signal,
  });
  if (!res.ok) return [];
  const player = extractPlayerResponse(await res.text());
  return player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

interface PlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
}

/** Pulls the `ytInitialPlayerResponse = {...};` JSON blob out of the page. */
export function extractPlayerResponse(html: string): PlayerResponse | null {
  const marker = 'ytInitialPlayerResponse';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const braceStart = html.indexOf('{', idx);
  if (braceStart === -1) return null;

  // Walk braces to find the matching close, ignoring braces inside strings.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(braceStart, i + 1)) as PlayerResponse;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Priority: manual > automatic, preferred language first (spec §3.3). */
export function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  const score = (t: CaptionTrack): number => {
    const manual = t.kind !== 'asr' ? 2 : 0;
    const langIdx = PREFERRED_LANGUAGES.indexOf(t.languageCode);
    const langScore = langIdx === -1 ? 0 : (PREFERRED_LANGUAGES.length - langIdx) * 4;
    return manual + langScore;
  };
  return [...tracks].sort((a, b) => score(b) - score(a))[0];
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}

async function fetchTrackSegments(
  track: CaptionTrack,
  signal?: AbortSignal,
): Promise<TranscriptSegment[]> {
  const url = new URL(track.baseUrl);
  url.searchParams.set('fmt', 'json3');
  const res = await fetch(url.toString(), { credentials: 'omit', signal });
  if (!res.ok) {
    throw new TldwError('NO_CAPTIONS_AVAILABLE', `Track fetch returned ${res.status}.`);
  }
  const data = (await res.json()) as { events?: Json3Event[] };

  const segments: TranscriptSegment[] = [];
  for (const ev of data.events ?? []) {
    const text = (ev.segs ?? [])
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const start = (ev.tStartMs ?? 0) / 1000;
    const end = start + (ev.dDurationMs ?? 0) / 1000;
    segments.push({ start, end, text });
  }
  return segments;
}

function normalize(
  video: DetectedVideo,
  language: string,
  segments: TranscriptSegment[],
): Transcript {
  return {
    videoId: video.id,
    source: 'youtube_captions',
    language,
    duration: video.duration ?? segments[segments.length - 1]?.end ?? 0,
    segments,
    fullText: buildFullText(segments),
    metadata: {
      title: video.title,
      provider: 'youtube',
      extractedAt: new Date().toISOString(),
    },
  };
}
