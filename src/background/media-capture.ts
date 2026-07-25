import type { MediaCandidate } from '@/transcription/media';
import { classifyMedia, isMediaUrl } from '@/transcription/media';

/**
 * Media segment capture (F5.1).
 *
 * Observes network requests on each tab and records candidate media URLs so the
 * audio fallback can find the stream. Purely observational — nothing is blocked
 * or modified. A bounded ring buffer per tab keeps memory in check.
 */

const MAX_PER_TAB = 40;
const captured = new Map<number, MediaCandidate[]>();

function record(tabId: number, url: string): void {
  if (tabId < 0 || !isMediaUrl(url)) return;
  const list = captured.get(tabId) ?? [];
  if (list.some((c) => c.url === url)) return;
  list.push({ url, kind: classifyMedia(url) });
  if (list.length > MAX_PER_TAB) list.shift();
  captured.set(tabId, list);
}

export function getCapturedMedia(tabId: number): MediaCandidate[] {
  return captured.get(tabId) ?? [];
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
