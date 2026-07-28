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

function resolveUri(uri: string, playlistUrl: string): string {
  if (uri.startsWith('http')) return uri;
  const base = playlistUrl.slice(0, playlistUrl.lastIndexOf('/') + 1);
  return base + uri;
}

/** Resolves relative segment URIs from an HLS playlist against its base URL. */
export function resolveSegmentUrls(playlist: string, playlistUrl: string): string[] {
  const urls: string[] = [];
  for (const rawLine of playlist.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    urls.push(resolveUri(line, playlistUrl));
  }
  return urls;
}

/** True for a master playlist (points to variant streams, not media segments). */
export function isHlsMaster(playlist: string): boolean {
  return playlist.includes('#EXT-X-STREAM-INF') || /#EXT-X-MEDIA:[^\n]*URI=/.test(playlist);
}

/**
 * From a master playlist, picks the lightest usable rendition: a dedicated audio
 * track if present, otherwise the lowest-bandwidth variant (we only need audio).
 */
export function pickHlsVariant(playlist: string, playlistUrl: string): string | null {
  const lines = playlist.split('\n').map((l) => l.trim());

  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(line)) {
      const uri = line.match(/URI="([^"]+)"/)?.[1];
      if (uri) return resolveUri(uri, playlistUrl);
    }
  }

  let best: { bandwidth: number; url: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const bandwidth = Number(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (uri && (!best || bandwidth < best.bandwidth)) {
      best = { bandwidth, url: resolveUri(uri, playlistUrl) };
    }
  }
  return best?.url ?? null;
}

export interface HlsMedia {
  /** Initialization segment (fMP4 `#EXT-X-MAP`), required before the fragments. */
  initUrl: string | null;
  segmentUrls: string[];
}

/** Parses a media playlist: the init segment (if fMP4) plus the media segments. */
export function parseHlsMedia(playlist: string, playlistUrl: string): HlsMedia {
  let initUrl: string | null = null;
  const segmentUrls: string[] = [];
  for (const rawLine of playlist.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MAP:')) {
      const uri = line.match(/URI="([^"]+)"/)?.[1];
      if (uri) initUrl = resolveUri(uri, playlistUrl);
      continue;
    }
    if (line.startsWith('#')) continue;
    segmentUrls.push(resolveUri(line, playlistUrl));
  }
  return { initUrl, segmentUrls };
}
