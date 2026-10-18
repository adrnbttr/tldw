import type { Broadcast, ContentMessage, JobState, LogMessage, Request, Response } from '@/types';
import { getSettings } from '@/storage';
import { sanitizeEntry } from '@/shared/logger';
import { log, logStore } from './log';
import { isContentScriptSender, isExtensionPageSender } from './sender-guard';
import { sanitizeDetectedVideos, sanitizeFrameKey } from './message-guard';
import {
  runJob,
  runBatch,
  getJobState,
  getJobsSnapshot,
  getKeyedJobs,
  runningJobIdFor,
  cancelJob,
  restoreJobs,
} from './orchestrator';
import { assembleDiagnosticsReport } from './diagnostics-handler';
import type { DiagnosticsSources } from './diagnostics-handler';
import { clearFrameCaptures, installMediaCapture } from './media-capture';
import { enrichVideos } from './enrich';
import { createTabVideos } from './tab-videos';
import { reconcileOrphanOffscreen } from '@/transcription/offscreen-session';
import { acceptOffscreenPort } from './offscreen-port';

/**
 * Last-ditch error nets: whatever escapes every handler below still lands in
 * the central buffer as an error entry — persisted immediately, since warn
 * and error entries skip the store's debounce — so a dying worker's last
 * words are not lost with it.
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
 * Liveness link of audio jobs (see src/offscreen/worker-link.ts): the
 * offscreen document holds a port open for the duration of a job; when this
 * worker dies, the port disconnects and the offscreen job aborts. Keeping the
 * worker alive is the job keepalive's business (keepalive.ts). The listener
 * must exist at top level: a connect without one disconnects at once.
 */
chrome.runtime.onConnect.addListener((port) => acceptOffscreenPort(port, chrome.runtime.id));

/**
 * A fresh worker has no live job, so a surviving offscreen document is an
 * orphan of its predecessor (maybe still downloading or transcribing): close
 * it. New audio jobs wait for this pass (offscreen-session.ts).
 */
void reconcileOrphanOffscreen();

/**
 * Service worker entry point (spec §2.2).
 *
 * - caches detected videos per tab (pushed by the content script)
 * - routes popup requests
 * - refuses every popup-only request from outside the extension's own pages
 * - broadcasts job progress so the popup can re-subscribe after reopening (F2)
 *
 * Allowed senders, per message received here (`chrome.runtime.onMessage`; other
 * extensions use onMessageExternal, which is not listened to):
 *
 * | Message            | Allowed sender                           | Scope / validation                      |
 * | ------------------ | ---------------------------------------- | --------------------------------------- |
 * | VIDEOS_DETECTED    | content script (our id, in a tab)         | own tab + frame (sender), shape & sizes |
 * | LOG                | any context of this extension             | entry re-validated + re-redacted        |
 * | LIST_VIDEOS        | extension page (popup)                    | active tab                              |
 * | RESCAN             | extension page (popup)                    | active tab                              |
 * | GET_JOBS           | extension page (popup)                    | —                                       |
 * | SUMMARIZE          | extension page (popup)                    | active tab; `force` bypasses the cache  |
 * | SUMMARIZE_BATCH    | extension page (popup)                    | active tab                              |
 * | CANCEL             | extension page (popup)                    | —                                       |
 * | CLEAR_LOGS         | extension page (popup)                    | —                                       |
 * | GET_DIAGNOSTICS    | extension page (popup)                    | —                                       |
 * | OFFSCREEN_PROGRESS | extension page (offscreen document)       | matched on the run's random `jobId`     |
 * | OFFSCREEN_RESULT   | extension page (offscreen document)       | matched on the run's random `jobId`     |
 *
 * Sent by this worker: OFFSCREEN_TRANSCRIBE (accepted by the offscreen document
 * from the worker only), REPORT_VIDEOS / PRIME_MEDIA / FETCH_TEXT (to a tab's
 * content scripts), JOB_STATE (broadcast to the popup).
 * "Extension page" = `isExtensionPageSender` (our id + a chrome-extension://<id>/
 * URL or origin); "content script" = `isContentScriptSender`.
 */

/** Requests only the popup (an extension page) may send. */
const POPUP_ONLY = new Set<string>([
  'LIST_VIDEOS',
  'RESCAN',
  'GET_JOBS',
  'SUMMARIZE',
  'SUMMARIZE_BATCH',
  'CANCEL',
  'CLEAR_LOGS',
  'GET_DIAGNOSTICS',
]);

/**
 * Per tab, the last list published by each frame — memory plus a mirror in
 * chrome.storage.session so a revived worker still knows the open tabs' videos
 * (see tab-videos.ts).
 */
const tabVideos = createTabVideos({
  session: chrome.storage.session,
  liveTabIds: async () =>
    (await chrome.tabs.query({})).flatMap((t) => (t.id != null ? [t.id] : [])),
  sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
});

function broadcast(state: JobState): void {
  chrome.runtime.sendMessage({ type: 'JOB_STATE', state } satisfies Broadcast).catch(() => {
    // No popup listening — expected, jobs keep running regardless.
  });
}

/**
 * The tab a summarize request is about: the active tab of the current window
 * at the moment the request arrives (the tab the popup was opened over) — or
 * the sender's own tab when the extension page sending it has one.
 */
async function requestTab(sender: chrome.runtime.MessageSender): Promise<number | undefined> {
  if (sender.tab?.id != null) return sender.tab.id;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  } catch {
    return undefined;
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: Request | ContentMessage | LogMessage,
    sender,
    sendResponse: (response: Response) => void,
  ) => {
    if (message == null || typeof message !== 'object') return false;

    // Detection results from a content script — for its own tab and frame only
    // (both read from the sender, never from the message).
    if (message.type === 'VIDEOS_DETECTED') {
      if (!isContentScriptSender(sender, chrome.runtime.id)) return false;
      const videos = sanitizeDetectedVideos(message.videos);
      if (!videos) return false;
      const tabId = sender.tab.id;
      const frameId = sender.frameId ?? 0;
      const applied = tabVideos.publish(
        tabId,
        frameId,
        videos,
        sender.documentId,
        sanitizeFrameKey(message.frameKey),
      );
      // A sub-frame retracting its videos (player gone, frame unloading): the
      // streams it issued belong to a video that is no longer there. A stale
      // retraction (from the frame's previous document, ignored by publish)
      // must not wipe the captures of the document now in the frame.
      if (applied && frameId > 0 && videos.length === 0) clearFrameCaptures(tabId, frameId);
      return false;
    }

    // A log line from another context — fire-and-forget, buffered by the worker.
    if (message.type === 'LOG') {
      if (sender.id !== chrome.runtime.id) return false;
      // Untrusted entry from the wire — validated and re-redacted before storage.
      const entry = sanitizeEntry(message.entry);
      if (entry) logStore.append(entry);
      return false;
    }

    // Popup-only requests: a content script (any frame of any page) must not
    // read jobs and summaries, start paid jobs, cancel them, or read logs.
    if (POPUP_ONLY.has(message.type) && !isExtensionPageSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, code: 'UNKNOWN', message: 'forbidden' });
      return false;
    }

    if (message.type === 'LIST_VIDEOS') {
      void (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        // After a worker restart the mirror answers at once (the frames are asked
        // to republish in the background); a tab it does not know is asked and
        // awaited briefly (tab-videos.ts).
        const cached = tab?.id != null ? await tabVideos.listForTab(tab.id) : [];
        const videos = await enrichVideos(cached);
        sendResponse({ ok: true, videos });
      })();
      return true;
    }

    if (message.type === 'RESCAN') {
      // Force detection on the active tab: every frame's content script is asked
      // to republish. Only a tab with no content script at all (opened before
      // the extension was installed or updated) gets the script injected — an
      // already-loaded ES module would not rerun its body on re-injection.
      void (async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id == null) {
          sendResponse({ ok: true, videos: [] });
          return;
        }
        await tabVideos.ready;
        const wait = tabVideos.waitForPublish(tab.id);
        // Republish request + sweep of the frames that stay silent (gone).
        if (!(await tabVideos.verify(tab.id))) {
          const js = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              files: js,
            });
          } catch {
            // Restricted page (chrome://, store, …) — nothing we can inject into.
          }
        }
        await wait; // first publish (+ settle) or timeout
        const videos = await enrichVideos(tabVideos.videosForTab(tab.id));
        sendResponse({ ok: true, videos });
      })();
      return true; // async response
    }

    if (message.type === 'GET_JOBS') {
      void (async () => {
        await jobsReady;
        sendResponse({ ok: true, jobs: getKeyedJobs() });
      })();
      return true; // async response
    }

    if (message.type === 'SUMMARIZE') {
      // The tab is fixed NOW, before any await: the audio fallback must
      // capture from (and prime) the tab the user asked from, not whatever
      // tab is active when the job gets there.
      const tab = requestTab(sender);
      void (async () => {
        const tabId = await tab;
        await jobsReady;
        // Fire and forget — the job runs in the worker; progress is broadcast.
        // The same video already running/queued is joined, not restarted: the
        // reply carries the state of the job that actually handles it (its
        // `videoId` may be another local id), so the popup can follow it.
        const jobId = runningJobIdFor(message.video) ?? message.video.id;
        void runJob(message.video, broadcast, { tabId, force: message.force === true });
        sendResponse({ ok: true, state: getJobState(jobId) });
      })();
      return true; // async response
    }

    if (message.type === 'SUMMARIZE_BATCH') {
      const tab = requestTab(sender);
      void (async () => {
        const tabId = await tab;
        await jobsReady;
        // Every item is registered (queued) before the reply, so the popup's
        // next GET_JOBS lists them all — cancellable and de-duplicated.
        void runBatch(message.videos, broadcast, { tabId });
        sendResponse({ ok: true });
      })();
      return true; // async response
    }

    if (message.type === 'CANCEL') {
      void (async () => {
        await jobsReady;
        cancelJob(message.videoId);
        sendResponse({ ok: true });
      })();
      return true; // async response
    }

    // Privileged log requests (gated with the other popup-only requests above)
    // — the buffer and the diagnostics report carry settings-adjacent data.
    if (message.type === 'CLEAR_LOGS') {
      void (async () => {
        try {
          await logStore.clear();
          sendResponse({ ok: true });
        } catch {
          sendResponse({ ok: false, code: 'UNKNOWN', message: 'clear failed' });
        }
      })();
      return true; // async response
    }

    if (message.type === 'GET_DIAGNOSTICS') {
      void (async () => {
        try {
          await jobsReady; // the jobs snapshot may still be restoring
          sendResponse({
            ok: true,
            report: await assembleDiagnosticsReport({
              settings: getSettings,
              jobs: getJobsSnapshot,
              logs: () => logStore.readAll(),
              manifest: () => chrome.runtime.getManifest(),
              userAgent: () => navigator.userAgent,
              // Vite injects the constant (vite.config.ts `define`); outside a
              // Vite bundle it stays undefined — the report then shows (none)
              // under ## Build instead of a ReferenceError.
              build: () => (typeof __TLDW_BUILD__ !== 'undefined' ? __TLDW_BUILD__ : null),
            } satisfies DiagnosticsSources),
          });
        } catch {
          sendResponse({ ok: false, code: 'UNKNOWN', message: 'diagnostics unavailable' });
        }
      })();
      return true; // async response — the sources read storage
    }

    return false;
  },
);

chrome.tabs.onRemoved.addListener((tabId) => tabVideos.forget(tabId));
// Chrome reports `loading` → `complete` for real navigations AND for same-document
// ones (pushState, hash): forgetting the tab on `loading` would wipe the lists of
// sub-frames that never republish (their player is untouched). Instead, once the
// tab is complete, every frame is asked to republish and the silent ones (gone
// documents) are dropped; departing documents also retract their own list.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') void tabVideos.verify(tabId);
});
