import type { FetchTextMessage } from '@/types';
import { log } from './log';
import { loggableUrl } from './loggable-url';

/**
 * Fetches a URL from a tab's content script, i.e. from the page's own origin.
 * Needed for resources gated to the page context (YouTube caption tracks
 * return empty when fetched from the service worker). The tab is the one the
 * job was requested from (fixed at request time) — never "the active tab now",
 * which may be an unrelated page by the time the job gets here. No tab → null.
 */
export async function fetchTextViaPage(url: string, tabId?: number): Promise<string | null> {
  if (tabId == null) return null;
  try {
    const message: FetchTextMessage = { type: 'FETCH_TEXT', url };
    const res = (await chrome.tabs.sendMessage(tabId, message)) as { text?: string } | undefined;
    const text = typeof res?.text === 'string' ? res.text : null;
    // No HTTP status crosses the wire here — the page does the fetching — so
    // the outcome is what the buffer gets (host + path, never the full URL).
    log.debug('page fetch', { url: loggableUrl(url), bytes: text?.length ?? 0 });
    return text;
  } catch (err) {
    log.debug('page fetch failed', {
      url: loggableUrl(url),
      error: err instanceof Error ? err.message : undefined,
    });
    return null;
  }
}
