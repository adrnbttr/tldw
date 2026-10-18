import type { DetectedVideo, Provider } from '@/types';

/**
 * Shape and size validation of what a content script publishes
 * (`VIDEOS_DETECTED`). A content script runs in a web page the page's own
 * script cannot reach, but its input is that page's DOM — so the worker trusts
 * nothing on the wire: unknown fields are dropped, strings are bounded, URLs
 * must be http(s), and a malformed entry is skipped rather than stored.
 */

/** At most this many videos per frame publish (a real page has a handful). */
export const MAX_VIDEOS_PER_FRAME = 100;
const MAX_ID = 128;
const MAX_EXTERNAL_ID = 512;
const MAX_TITLE = 500;
const MAX_URL = 8192;

const PROVIDERS: ReadonlySet<Provider> = new Set([
  'youtube',
  'vimeo',
  'drive',
  'native',
  'unknown',
]);

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

/** An http(s) URL of bounded length, else null (the field is dropped, not the video). */
function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

/** One published video, normalized — or null when it is malformed. */
export function sanitizeDetectedVideo(raw: unknown): DetectedVideo | null {
  if (raw == null || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const id = boundedString(v.id, MAX_ID);
  if (!id) return null;
  if (typeof v.provider !== 'string' || !PROVIDERS.has(v.provider as Provider)) return null;
  const externalId = v.externalId == null ? '' : boundedString(v.externalId, MAX_EXTERNAL_ID);
  if (externalId == null) return null;
  const title =
    v.title == null ? null : typeof v.title === 'string' ? v.title.slice(0, MAX_TITLE) : undefined;
  if (title === undefined) return null;
  const duration =
    v.duration == null
      ? null
      : typeof v.duration === 'number' && Number.isFinite(v.duration) && v.duration >= 0
        ? v.duration
        : undefined;
  if (duration === undefined) return null;
  const iframeSrc = httpUrl(v.iframeSrc);
  const mediaSrc = httpUrl(v.mediaSrc);
  // `frameId` is stamped by the worker from the sender, never taken from the wire.
  return {
    id,
    provider: v.provider as Provider,
    externalId,
    title,
    duration,
    iframeSrc,
    mediaSrc,
    isPlaying: v.isPlaying === true,
  };
}

/** A whole publish: an array of at most {@link MAX_VIDEOS_PER_FRAME} valid videos, or null. */
export function sanitizeDetectedVideos(raw: unknown): DetectedVideo[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_VIDEOS_PER_FRAME) return null;
  const out: DetectedVideo[] = [];
  for (const item of raw) {
    const video = sanitizeDetectedVideo(item);
    if (video) out.push(video);
  }
  return out;
}

/** The frame's own embed identity (`ContentMessage.frameKey`): a bounded string, else null. */
export function sanitizeFrameKey(raw: unknown): string | null {
  return boundedString(raw, MAX_EXTERNAL_ID) || null;
}
