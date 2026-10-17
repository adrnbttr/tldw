import type { MediaCandidate, MediaKind } from '@/transcription/media';
import { classifyMedia, isMediaUrl, normalizeMediaUrl } from '@/transcription/media';
import { log } from './log';
import { loggableUrl } from './loggable-url';

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

/**
 * At most one debug line per tab + host: `record` runs inside the webRequest
 * listener — a hot loop — so a segment flood must not flood the buffer too.
 * Hosts already logged for a tab stay silent afterwards.
 */
const loggedHosts = new Map<number, Set<string>>();

/** Guarded, de-duplicated debug trail of what capture accepts (never a signed URL). */
function logCapture(tabId: number, url: string, kind: MediaKind): void {
  const printable = loggableUrl(url);
  if (!printable) return;
  // Manifests name the stream and only appear a few times per tab — always
  // worth one line each.
  if (MANIFEST_KINDS.has(kind)) {
    log.debug('media captured', { tabId, kind, url: printable });
    return;
  }
  const host = printable.split('/')[0];
  const seen = loggedHosts.get(tabId) ?? new Set<string>();
  if (seen.has(host)) return;
  seen.add(host);
  loggedHosts.set(tabId, seen);
  log.debug('media captured', { tabId, kind, url: printable });
}

function record(tabId: number, rawUrl: string): void {
  if (tabId < 0) return;
  // Strip byte-range params (googlevideo chunks) so all requests for the same
  // file land on one "whole file" URL and de-duplicate against each other.
  const url = normalizeMediaUrl(rawUrl);
  if (!isMediaUrl(url)) return;
  const kind = classifyMedia(url);
  const entry = captured.get(tabId) ?? { manifests: [], segments: [] };
  const bucket = MANIFEST_KINDS.has(kind) ? entry.manifests : entry.segments;
  if (bucket.some((c) => c.url === url)) return;
  bucket.push({ url, kind });
  if (bucket === entry.segments && entry.segments.length > MAX_SEGMENTS_PER_TAB) {
    entry.segments.shift();
  }
  captured.set(tabId, entry);
  logCapture(tabId, url, kind);
}

export function getCapturedMedia(tabId: number): MediaCandidate[] {
  const entry = captured.get(tabId);
  const media = entry ? [...entry.manifests, ...entry.segments] : [];
  const hosts = [
    ...new Set(
      media
        .map((m) => loggableUrl(m.url)?.split('/')[0])
        .filter((host): host is string => host != null),
    ),
  ];
  log.debug('captured media for tab', { tabId, count: media.length, hosts });
  return media;
}

export function clearCapturedMedia(tabId: number): void {
  captured.delete(tabId);
  loggedHosts.delete(tabId);
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
