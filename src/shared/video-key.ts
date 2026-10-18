import type { DetectedVideo } from '@/types';

/**
 * Stable identity of a video across re-scans (F2).
 *
 * `DetectedVideo.id` is stable for an element's lifetime in its document only
 * (content/index.ts), so the popup and the worker match jobs to videos on this
 * key instead — and the content script and the worker de-duplicate on it:
 * `provider:externalId`
 * (the history cache key) when the host id is known; otherwise a hash of the
 * native media URL / embed URL — hashed so a signed URL never ends up in
 * session storage or a diagnostic; the local id as a last resort.
 */
export function videoKey(
  video: Pick<DetectedVideo, 'id' | 'provider' | 'externalId' | 'mediaSrc' | 'iframeSrc'>,
): string {
  return stableVideoKey(video) ?? `id:${video.id}`;
}

/**
 * The identity part of {@link videoKey}, or null when the video has no stable
 * identity (no host id and no URL). Single definition shared with the history
 * / cache keys in storage. URL fragments are ignored; the URL itself is hashed.
 */
export function stableVideoKey(
  video: Pick<DetectedVideo, 'provider' | 'externalId' | 'mediaSrc' | 'iframeSrc'>,
): string | null {
  if (video.externalId) return `${video.provider}:${video.externalId}`;
  const url = (video.mediaSrc || video.iframeSrc || '').split('#')[0];
  if (url) return `${video.provider}:#${fnv1a(url)}`;
  return null;
}

/** 32-bit FNV-1a, hex — a cheap, deterministic, non-reversible-enough tag. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
