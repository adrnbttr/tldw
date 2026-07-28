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
    const diag: string[] = [];
    try {
      const tracks = await fetchCaptionTracks(video.externalId, diag, signal);
      if (tracks.length === 0) {
        throw new TldwError('NO_CAPTIONS_AVAILABLE', 'No caption tracks.', diag.join(' '));
      }

      const track = pickTrack(tracks);
      diag.push(`picked=${track?.languageCode ?? '?'} base=${track?.baseUrl ? 'y' : 'NO'}`);
      const segments = await fetchTrackSegments(track, diag, signal);
      if (segments.length === 0) {
        throw new TldwError('NO_CAPTIONS_AVAILABLE', 'Empty caption track.', diag.join(' '));
      }

      return normalize(video, track.languageCode, segments);
    } catch (err) {
      if (err instanceof TldwError) throw err;
      // Any unexpected failure becomes a typed, diagnosable NO_CAPTIONS.
      throw new TldwError(
        'NO_CAPTIONS_AVAILABLE',
        'Caption extraction failed.',
        `${err} ${diag.join(' ')}`,
      );
    }
  },
};

// Public "WEB" InnerTube key — stable and used by the site itself.
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

async function fetchCaptionTracks(
  videoId: string,
  diag: string[],
  signal?: AbortSignal,
): Promise<CaptionTrack[]> {
  // InnerTube first (reliable JSON API), then scrape the watch page as a fallback.
  // credentials:'include' reuses the user's YouTube session so no consent wall.
  const viaApi = await fetchViaInnertube(videoId, diag, signal).catch((e) => {
    diag.push(`innertube-err=${e}`);
    return [];
  });
  if (viaApi.length > 0) return viaApi;
  return fetchViaWatchPage(videoId, diag, signal).catch((e) => {
    diag.push(`watch-err=${e}`);
    return [];
  });
}

/** YouTube's internal player API — avoids the fragile HTML scrape / consent wall. */
async function fetchViaInnertube(
  videoId: string,
  diag: string[],
  signal?: AbortSignal,
): Promise<CaptionTrack[]> {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      videoId,
      context: {
        client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en' },
      },
    }),
    signal,
  });
  diag.push(`innertube=${res.status}`);
  if (!res.ok) return [];
  const data = (await res.json()) as PlayerResponse & { playabilityStatus?: { status?: string } };
  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  diag.push(`play=${data.playabilityStatus?.status ?? '?'} tracks=${tracks.length}`);
  return tracks;
}

async function fetchViaWatchPage(
  videoId: string,
  diag: string[],
  signal?: AbortSignal,
): Promise<CaptionTrack[]> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    credentials: 'include',
    signal,
  });
  diag.push(`watch=${res.status}`);
  if (!res.ok) return [];
  const player = extractPlayerResponse(await res.text());
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  diag.push(`watch-tracks=${tracks.length}`);
  return tracks;
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
  diag: string[],
  signal?: AbortSignal,
): Promise<TranscriptSegment[]> {
  if (!track?.baseUrl) return [];
  const url = new URL(track.baseUrl);
  url.searchParams.set('fmt', 'json3');
  const res = await fetch(url.toString(), { credentials: 'include', signal });
  diag.push(`track=${res.status}`);
  if (!res.ok) {
    throw new TldwError(
      'NO_CAPTIONS_AVAILABLE',
      `Track fetch returned ${res.status}.`,
      diag.join(' '),
    );
  }
  const raw = await res.text();
  let data: { events?: Json3Event[] };
  try {
    data = JSON.parse(raw) as { events?: Json3Event[] };
  } catch {
    diag.push(`track-nonjson len=${raw.length}`);
    return [];
  }

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
