import type {
  Broadcast,
  ContentMessage,
  JobProgress,
  JobState,
  LogMessage,
  Request,
  Response,
} from '@/types';
import type { BatchState } from '@/types';
import { sanitizeEntry } from '@/shared/logger';
import { log, logStore } from './log';
import {
  runJob,
  runBatch,
  getJobState,
  getActiveJob,
  getBatchState,
  cancelJob,
  restoreJobs,
} from './orchestrator';
import { installMediaCapture } from './media-capture';
import { enrichVideos } from './enrich';

/**
 * Last-ditch error nets: whatever escapes every handler below still lands in
 * the central buffer as an error entry — persisted immediately, since error
 * entries skip the store's debounce — so a dying worker's last words are not
 * lost with it.
 */
self.addEventListener('error', (event) => {
  log.error('uncaught error', {
    message: event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
});

self.addEventListener('unhandledrejection', (event) => {
  const { reason } = event;
  log.error('unhandled rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

installMediaCapture();

// Startup breadcrumb — lands in the central log buffer, persisted by the store.
log.info('sw started', { version: chrome.runtime.getManifest().version });

/**
 * Hydrate persisted job state on worker wake-up. MV3 kills idle workers at any
 * time; every handler that reads or writes job state awaits this promise so a
 * revived worker never reports `idle` for a job that was running when its
 * predecessor died, and never lets a fresh job race the restore. Started
 * synchronously so a message can only race it, never miss it.
 */
const jobsReady = restoreJobs();

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
  (
    message: Request | ContentMessage | LogMessage,
    sender,
    sendResponse: (response: Response) => void,
  ) => {
    // Detection results from a content script.
    if (message.type === 'VIDEOS_DETECTED') {
      if (sender.tab?.id != null) videosByTab.set(sender.tab.id, message.videos);
      return false;
    }

    // A log line from another context — fire-and-forget, buffered by the worker.
    if (message.type === 'LOG') {
      // Untrusted entry from the wire — validated and re-redacted before storage.
      const entry = sanitizeEntry(message.entry);
      if (entry) logStore.append(entry);
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
      void (async () => {
        await jobsReady;
        sendResponse({ ok: true, state: getJobState(message.videoId) });
      })();
      return true; // async response — job state may still be restoring
    }

    if (message.type === 'GET_ACTIVE_JOB') {
      void (async () => {
        await jobsReady;
        sendResponse({ ok: true, active: getActiveJob() });
      })();
      return true; // async response
    }

    if (message.type === 'SUMMARIZE') {
      void (async () => {
        await jobsReady;
        // Fire and forget — the job runs in the worker; progress is broadcast.
        void runJob(message.video, broadcast);
        sendResponse({ ok: true });
      })();
      return true; // async response
    }

    if (message.type === 'SUMMARIZE_BATCH') {
      void (async () => {
        await jobsReady;
        void runBatch(message.videos, broadcast, broadcastBatch);
        sendResponse({ ok: true });
      })();
      return true; // async response
    }

    if (message.type === 'GET_BATCH_STATE') {
      sendResponse({ ok: true, batch: getBatchState() });
      return false;
    }

    if (message.type === 'CANCEL') {
      void (async () => {
        await jobsReady;
        cancelJob(message.videoId);
        sendResponse({ ok: true });
      })();
      return true; // async response
    }

    if (message.type === 'GET_LOGS') {
      void (async () => {
        sendResponse({ ok: true, logs: await logStore.readAll() });
      })();
      return true; // async response — the store may still be flushing
    }

    if (message.type === 'CLEAR_LOGS') {
      void (async () => {
        await logStore.clear();
        sendResponse({ ok: true });
      })();
      return true; // async response
    }

    return false;
  },
);

chrome.tabs.onRemoved.addListener((tabId) => videosByTab.delete(tabId));
