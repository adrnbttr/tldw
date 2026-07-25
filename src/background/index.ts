import type { Broadcast, ContentMessage, JobProgress, JobState, Request, Response } from '@/types';
import { runJob, getJobState, cancelJob } from './orchestrator';

/**
 * Service worker entry point (spec §2.2).
 *
 * - caches detected videos per tab (pushed by the content script)
 * - routes popup requests
 * - broadcasts job progress so the popup can re-subscribe after reopening (F2)
 */

const videosByTab = new Map<number, ContentMessage['videos']>();

function broadcast(state: JobState, progress?: JobProgress): void {
  const messages: Broadcast[] = [{ type: 'JOB_STATE', state }];
  if (progress) messages.push({ type: 'JOB_PROGRESS', progress });
  for (const msg of messages) {
    chrome.runtime.sendMessage(msg).catch(() => {
      // No popup listening — expected, jobs keep running regardless.
    });
  }
}

chrome.runtime.onMessage.addListener(
  (message: Request | ContentMessage, sender, sendResponse: (response: Response) => void) => {
    // Detection results from a content script.
    if (message.type === 'VIDEOS_DETECTED') {
      if (sender.tab?.id != null) videosByTab.set(sender.tab.id, message.videos);
      return false;
    }

    if (message.type === 'LIST_VIDEOS') {
      void (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const videos = tab?.id != null ? (videosByTab.get(tab.id) ?? []) : [];
        sendResponse({ ok: true, videos });
      })();
      return true;
    }

    if (message.type === 'GET_JOB_STATE') {
      sendResponse({ ok: true, state: getJobState(message.videoId) });
      return false;
    }

    if (message.type === 'SUMMARIZE') {
      // Fire and forget — the job runs in the worker; progress is broadcast.
      void runJob(message.video, broadcast);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'CANCEL') {
      cancelJob(message.videoId);
      sendResponse({ ok: true });
      return false;
    }

    return false;
  },
);

chrome.tabs.onRemoved.addListener((tabId) => videosByTab.delete(tabId));
