/**
 * Media source classification (F5.1).
 *
 * The service worker observes network requests via chrome.webRequest and records
 * candidate media URLs. These pure helpers classify and rank them so the audio
 * fallback knows what it is dealing with.
 */

export type MediaKind = 'vimeo_master' | 'hls' | 'dash' | 'progressive' | 'segment' | 'unknown';

export interface MediaCandidate {
  url: string;
  kind: MediaKind;
}

const VIMEO_MASTER = /\/(?:master|playlist)\.(?:json|mpd)(\?|$)/i;
const HLS = /\.m3u8(\?|$)/i;
const DASH = /\.mpd(\?|$)/i;
const PROGRESSIVE = /\.mp4(\?|$)/i;
const SEGMENT = /(\.ts|\.m4s|segment|vimeocdn\.com\/.*\/(?:audio|video))/i;

// Google Drive / YouTube serve media from googlevideo.com/videoplayback as byte
// ranges of a whole file: no file extension, the `mime` query param carries the
// content type (video/mp4, audio/mp4, …). Only genuine media mimes are kept, so
// non-media videoplayback requests stay `unknown`.
const GOOGLEVIDEO = /googlevideo\.com\/videoplayback(\?|$)/i;
const MEDIA_MIME = /[?&]mime=(?:audio|video)(?:%2f|\/)/i;
const AUDIO_MIME = /[?&]mime=audio(?:%2f|\/)/i;

export function classifyMedia(url: string): MediaKind {
  if (VIMEO_MASTER.test(url)) return 'vimeo_master';
  if (HLS.test(url)) return 'hls';
  if (DASH.test(url)) return 'dash';
  if (GOOGLEVIDEO.test(url) && MEDIA_MIME.test(url)) return 'progressive';
  if (PROGRESSIVE.test(url)) return 'progressive';
  if (SEGMENT.test(url)) return 'segment';
  return 'unknown';
}

/** Whether a request URL is worth recording as a media candidate. */
export function isMediaUrl(url: string): boolean {
  return classifyMedia(url) !== 'unknown';
}

/** True for googlevideo /videoplayback URLs (Google Drive / YouTube media). */
export function isGoogleVideoUrl(url: string): boolean {
  return GOOGLEVIDEO.test(url);
}

/** Byte-range params googlevideo adds to every chunk request of one file. */
const RANGE_PARAMS = new Set(['range', 'rn', 'rbuf']);

/**
 * Strips the byte-range query params (`range`, `rn`, `rbuf`) googlevideo adds to
 * each chunk request, so every chunk of the same file normalizes to one
 * "whole file" URL and de-duplicates against it. Param names match
 * case-insensitively; everything else is preserved verbatim.
 */
export function normalizeMediaUrl(url: string): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const body = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = body.indexOf('?');
  if (queryAt === -1) return url;
  const params = body
    .slice(queryAt + 1)
    .split('&')
    .filter((p) => !RANGE_PARAMS.has(p.split('=', 1)[0].toLowerCase()));
  const base = body.slice(0, queryAt);
  return params.length > 0 ? `${base}?${params.join('&')}${hash}` : `${base}${hash}`;
}

/** True for URLs that stream an audio-only track (e.g. a googlevideo audio itag). */
export function isAudioOnlyUrl(url: string): boolean {
  return AUDIO_MIME.test(url);
}

/**
 * Picks the best source to work from. Preference order:
 *   progressive MP4  (single file, easiest to extract audio from)
 *   HLS playlist     (segment list we can assemble)
 *   DASH manifest
 *   raw segment      (last resort)
 *
 * Ties within a kind are broken toward an audio-only stream (e.g. a googlevideo
 * audio itag instead of its video twin): transcription only needs the audio.
 */
const KIND_RANK: Record<MediaKind, number> = {
  vimeo_master: 6,
  progressive: 5,
  hls: 4,
  dash: 3,
  segment: 1,
  unknown: 0,
};

export function pickBestCandidate(candidates: MediaCandidate[]): MediaCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const byKind = KIND_RANK[b.kind] - KIND_RANK[a.kind];
    if (byKind !== 0) return byKind;
    return Number(isAudioOnlyUrl(b.url)) - Number(isAudioOnlyUrl(a.url));
  })[0];
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

/**
 * Vimeo DASH manifest (`master.json?base64_init=1`). Fields we use; the format is
 * proprietary and may change, so parsing stays defensive.
 */
export interface VimeoRendition {
  base_url?: string;
  bitrate?: number;
  init_segment?: string;
  segments?: Array<{ url?: string }>;
}
export interface VimeoMaster {
  base_url?: string;
  audio?: VimeoRendition[];
  video?: VimeoRendition[];
}

export interface VimeoMasterPlan {
  /** Base64 fMP4 initialization segment. */
  initBase64: string | null;
  segmentUrls: string[];
}

/** Picks the lightest audio rendition and resolves its init + segment URLs. */
export function parseVimeoMaster(master: VimeoMaster, masterUrl: string): VimeoMasterPlan {
  const audios = Array.isArray(master.audio) ? master.audio : [];
  const videos = Array.isArray(master.video) ? master.video : [];
  const rendition = [...audios].sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0))[0] ?? videos[0];
  if (!rendition) return { initBase64: null, segmentUrls: [] };

  const masterBase = new URL(master.base_url ?? '.', masterUrl);
  const renditionBase = new URL(rendition.base_url ?? '.', masterBase);
  const segments = Array.isArray(rendition.segments) ? rendition.segments : [];
  const segmentUrls = segments
    .map((s) => (typeof s.url === 'string' ? new URL(s.url, renditionBase).toString() : null))
    .filter((u): u is string => u !== null);

  return {
    initBase64: typeof rendition.init_segment === 'string' ? rendition.init_segment : null,
    segmentUrls,
  };
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
