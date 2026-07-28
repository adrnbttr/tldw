import type { FetchTextMessage } from '@/types';

/**
 * Fetches a URL from the active tab's content script, i.e. from the page's own
 * origin. Needed for resources gated to the page context (YouTube caption tracks
 * return empty when fetched from the service worker).
 */
export async function fetchTextViaPage(url: string): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return null;
    const message: FetchTextMessage = { type: 'FETCH_TEXT', url };
    const res = (await chrome.tabs.sendMessage(tab.id, message)) as { text?: string } | undefined;
    return typeof res?.text === 'string' ? res.text : null;
  } catch {
    return null;
  }
}
