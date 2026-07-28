import type { MediaCandidate, MediaKind } from '@/transcription/media';
import { classifyMedia, isMediaUrl } from '@/transcription/media';

/**
 * Media segment capture (F5.1).
 *
 * Observes network requests on each tab and records candidate media URLs so the
 * audio fallback can find the stream. Purely observational — nothing is blocked.
 *
 * Manifests (master.json / HLS / DASH) are kept in a separate, non-evicting set:
 * they are requested once, up front, and must not be pushed out of the buffer by
 * the flood of media segments that follows.
 */

const MAX_SEGMENTS_PER_TAB = 60;
const MANIFEST_KINDS = new Set<MediaKind>(['vimeo_master', 'hls', 'dash']);

interface TabCapture {
  manifests: MediaCandidate[];
  segments: MediaCandidate[];
}

const captured = new Map<number, TabCapture>();

function record(tabId: number, url: string): void {
  if (tabId < 0 || !isMediaUrl(url)) return;
  const kind = classifyMedia(url);
  const entry = captured.get(tabId) ?? { manifests: [], segments: [] };
  const bucket = MANIFEST_KINDS.has(kind) ? entry.manifests : entry.segments;
  if (bucket.some((c) => c.url === url)) return;
  bucket.push({ url, kind });
  if (bucket === entry.segments && entry.segments.length > MAX_SEGMENTS_PER_TAB) {
    entry.segments.shift();
  }
  captured.set(tabId, entry);
}

export function getCapturedMedia(tabId: number): MediaCandidate[] {
  const entry = captured.get(tabId);
  return entry ? [...entry.manifests, ...entry.segments] : [];
}

export function clearCapturedMedia(tabId: number): void {
  captured.delete(tabId);
}

/** Registers the webRequest listener. Safe to call once at startup. */
export function installMediaCapture(): void {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId >= 0) record(details.tabId, details.url);
    },
    { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'object'] },
  );

  chrome.tabs.onRemoved.addListener((tabId) => clearCapturedMedia(tabId));
}
