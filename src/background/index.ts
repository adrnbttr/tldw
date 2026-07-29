import type { Broadcast, ContentMessage, JobProgress, JobState, Request, Response } from '@/types';
import type { BatchState } from '@/types';
import {
  runJob,
  runBatch,
  getJobState,
  getActiveJob,
  getBatchState,
  cancelJob,
} from './orchestrator';
import { installMediaCapture } from './media-capture';
import { enrichVideos } from './enrich';

installMediaCapture();

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

function broadcastBatch(state: BatchState): void {
  chrome.runtime.sendMessage({ type: 'BATCH_STATE', state } satisfies Broadcast).catch(() => {
    // No popup listening — expected.
  });
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
        const cached = tab?.id != null ? (videosByTab.get(tab.id) ?? []) : [];
        const videos = await enrichVideos(cached);
        // Keep the enriched copy so later opens are instant.
        if (tab?.id != null) videosByTab.set(tab.id, videos);
        sendResponse({ ok: true, videos });
      })();
      return true;
    }

    if (message.type === 'RESCAN') {
      // Force detection on the active tab — re-inject the content script (covers
      // tabs opened before the extension loaded, where it never ran), then read
      // the freshly published list.
      void (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id == null) {
          sendResponse({ ok: true, videos: [] });
          return;
        }
        const js = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: js });
        } catch {
          // Restricted page (chrome://, store, …) — nothing we can inject into.
        }
        // Give the content script a beat to scan and publish.
        await new Promise((resolve) => setTimeout(resolve, 350));
        const cached = videosByTab.get(tab.id) ?? [];
        const videos = await enrichVideos(cached);
        videosByTab.set(tab.id, videos);
        sendResponse({ ok: true, videos });
      })();
      return true; // async response
    }

    if (message.type === 'GET_JOB_STATE') {
      sendResponse({ ok: true, state: getJobState(message.videoId) });
      return false;
    }

    if (message.type === 'GET_ACTIVE_JOB') {
      sendResponse({ ok: true, active: getActiveJob() });
      return false;
    }

    if (message.type === 'SUMMARIZE') {
      // Fire and forget — the job runs in the worker; progress is broadcast.
      void runJob(message.video, broadcast);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'SUMMARIZE_BATCH') {
      void runBatch(message.videos, broadcast, broadcastBatch);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'GET_BATCH_STATE') {
      sendResponse({ ok: true, batch: getBatchState() });
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
