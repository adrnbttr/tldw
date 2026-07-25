/**
 * Media source classification (F5.1).
 *
 * The service worker observes network requests via chrome.webRequest and records
 * candidate media URLs. These pure helpers classify and rank them so the audio
 * fallback knows what it is dealing with.
 */

export type MediaKind = 'hls' | 'dash' | 'progressive' | 'segment' | 'unknown';

export interface MediaCandidate {
  url: string;
  kind: MediaKind;
}

const HLS = /\.m3u8(\?|$)/i;
const DASH = /\.mpd(\?|$)/i;
const PROGRESSIVE = /\.mp4(\?|$)/i;
const SEGMENT = /(\.ts|\.m4s|segment|vimeocdn\.com\/.*\/(?:audio|video))/i;

export function classifyMedia(url: string): MediaKind {
  if (HLS.test(url)) return 'hls';
  if (DASH.test(url)) return 'dash';
  if (PROGRESSIVE.test(url)) return 'progressive';
  if (SEGMENT.test(url)) return 'segment';
  return 'unknown';
}

/** Whether a request URL is worth recording as a media candidate. */
export function isMediaUrl(url: string): boolean {
  return classifyMedia(url) !== 'unknown';
}

/**
 * Picks the best source to work from. Preference order:
 *   progressive MP4  (single file, easiest to extract audio from)
 *   HLS playlist     (segment list we can assemble)
 *   DASH manifest
 *   raw segment      (last resort)
 */
const KIND_RANK: Record<MediaKind, number> = {
  progressive: 4,
  hls: 3,
  dash: 2,
  segment: 1,
  unknown: 0,
};

export function pickBestCandidate(candidates: MediaCandidate[]): MediaCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind])[0];
}

/** Resolves relative segment URIs from an HLS playlist against its base URL. */
export function resolveSegmentUrls(playlist: string, playlistUrl: string): string[] {
  const base = playlistUrl.slice(0, playlistUrl.lastIndexOf('/') + 1);
  const urls: string[] = [];
  for (const rawLine of playlist.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    urls.push(line.startsWith('http') ? line : base + line);
  }
  return urls;
}
