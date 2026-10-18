/**
 * Coarse, non-identifying description of a URL for logs and diagnostics.
 *
 * Signed media URLs hide capabilities in the path as well as the query
 * (Akamai `~hmac=`, path-form googlevideo `/sig/…`, Drive `/file/d/<id>/`),
 * so only the host survives, plus a hint of the shape: first path segment when
 * it is a known safe word, the file extension and the segment count. A public
 * YouTube video id (`/embed/<id>`) is kept — it is not a secret.
 *
 * Output shape: `host/<word|*>[.ext] (N seg)` — the host is always the part
 * before the first `/`.
 */

const SAFE_FIRST_SEGMENTS = new Set([
  'videoplayback',
  'file',
  'embed',
  'watch',
  'video',
  'videos',
  'v',
  'api',
  'oembed',
  'manifest',
  'playlist',
  'hls',
  'dash',
  'drive',
  'shorts',
  'live',
  'timedtext',
]);

const YOUTUBE_HOST = /(^|\.)youtube(-nocookie)?\.com$/i;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const EXTENSION = /\.([A-Za-z0-9]{1,5})$/;

export function describeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return `${url.host}/`;

  const first = segments[0].toLowerCase();
  if (
    YOUTUBE_HOST.test(url.hostname) &&
    first === 'embed' &&
    segments.length === 2 &&
    YOUTUBE_ID.test(segments[1])
  ) {
    return `${url.host}/embed/${segments[1]}`;
  }

  const word = SAFE_FIRST_SEGMENTS.has(first) ? first : '*';
  const ext = EXTENSION.exec(segments[segments.length - 1])?.[1]?.toLowerCase();
  return `${url.host}/${word}${ext ? `.${ext}` : ''} (${segments.length} seg)`;
}
