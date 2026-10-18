import type { ContentMessage, DetectedVideo } from '@/types';
import { mergeFrameVideos, setFrameVideos } from './frame-videos';

/**
 * Per-tab registry of the videos each frame published (F1), surviving a
 * service-worker restart.
 *
 * The map lives in memory but is mirrored per tab into `chrome.storage.session`
 * (RAM-backed, cleared when the browser closes) and restored on worker start. A
 * revived worker also asks the page's content scripts to republish
 * (`REPORT_VIDEOS`), since a content script only publishes when its list changes.
 *
 * A frame's entry is replaced by its own publishes only — never cleared by
 * another frame's. Entries of documents that are gone are dropped by the frame
 * itself (`pagehide` retraction) and, as a safety net, by {@link verify}: run
 * when a tab finishes loading (`status: 'complete'`, which Chrome also fires
 * for pushState / hash navigations) and after a worker restart, it asks every
 * frame to republish and drops the frames that did not answer.
 */

const PREFIX = 'frames:';
/** How long LIST_VIDEOS / RESCAN wait for the frames to answer a report request. */
export const REPORT_WAIT_MS = 800;
/** After the first publish, a short grace period lets the other frames chime in. */
export const SETTLE_MS = 120;
/** How long {@link verify} gives the frames to republish before dropping the silent ones. */
export const VERIFY_MS = 1500;
/** Margin past {@link VERIFY_MS} a list waits for a sweep in flight before answering anyway. */
const VERIFY_GRACE_MS = 200;

/** `chrome.tabs.sendMessage` rejects with these when no content script listens. */
const NO_RECEIVER = /Receiving end does not exist|Could not establish connection/i;

type FrameList = ContentMessage['videos'];
/**
 * Mirror shape: `[frameId, videos]`, plus the frame's own embed identity
 * (`ContentMessage.frameKey`) when it has one — older mirrors lack it.
 */
type StoredFrames = Array<[number, FrameList] | [number, FrameList, string]>;

export interface TabVideosDeps {
  session: Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
  /** Ids of the tabs that currently exist (stale persisted entries are dropped). */
  liveTabIds: () => Promise<number[]>;
  sendToTab: (tabId: number, message: { type: 'REPORT_VIDEOS' }) => Promise<unknown>;
}

/** In-memory bookkeeping of a frame entry (not persisted). */
interface FrameMeta {
  /** Document that published the entry (`sender.documentId`), when known. */
  docId?: string;
  /** Publish sequence number; 0 for entries restored from session storage. */
  seq: number;
}

/** Same videos, same fields (a frame republishing what it already published). */
function sameList(a: FrameList, b: FrameList): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

export function createTabVideos(deps: TabVideosDeps) {
  const framesByTab = new Map<number, Map<number, FrameList>>();
  /** Per tab, the identity each frame derives from its own URL (see frame-videos.ts). */
  const keysByTab = new Map<number, Map<number, string>>();
  const metaByTab = new Map<number, Map<number, FrameMeta>>();
  /** Tabs holding entries restored from storage, not yet verified. */
  const restored = new Set<number>();
  /**
   * Latest verification in flight per tab: `token` identifies it (a newer one
   * supersedes it), entries published after `since` count as refreshed.
   */
  const verifying = new Map<number, { token: number; since: number }>();
  let seq = 0;
  /** Tabs that published since this worker started (their data is fresh). */
  const live = new Set<number>();
  /** Tabs for which a report was already requested — don't wait again. */
  const asked = new Set<number>();
  const waiters = new Map<number, Array<() => void>>();
  /** Callers waiting for the tab's verification in flight to settle (listForTab). */
  const verifyWaiters = new Map<number, Array<() => void>>();

  const ready = (async () => {
    try {
      const [all, tabIds] = await Promise.all([deps.session.get(null), deps.liveTabIds()]);
      const alive = new Set(tabIds);
      const stale: string[] = [];
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(PREFIX)) continue;
        const tabId = Number(key.slice(PREFIX.length));
        if (!alive.has(tabId)) {
          stale.push(key);
          continue;
        }
        if (framesByTab.has(tabId)) continue; // a live publish already won
        const entries = value as StoredFrames;
        framesByTab.set(tabId, new Map(entries.map(([frameId, list]) => [frameId, list])));
        const keys = new Map<number, string>();
        for (const [frameId, , key] of entries) if (typeof key === 'string') keys.set(frameId, key);
        keysByTab.set(tabId, keys);
        restored.add(tabId);
      }
      if (stale.length) await deps.session.remove(stale);
    } catch {
      // Session storage unavailable — start empty, content scripts will republish.
    }
  })();

  function persist(tabId: number): void {
    const frames = framesByTab.get(tabId);
    const keys = keysByTab.get(tabId);
    const entries: StoredFrames = frames
      ? [...frames.entries()].map(([frameId, list]) => {
          const key = keys?.get(frameId);
          return key ? [frameId, list, key] : [frameId, list];
        })
      : [];
    const op = frames
      ? deps.session.set({ [PREFIX + tabId]: entries })
      : deps.session.remove(PREFIX + tabId);
    void Promise.resolve(op).catch(() => {});
  }

  function resolveWaiters(tabId: number): void {
    const list = waiters.get(tabId);
    if (!list) return;
    waiters.delete(tabId);
    for (const fn of list) fn();
  }

  /**
   * Records what one frame published. `docId` (the sender's documentId) lets a
   * late retraction from a frame's previous document be told apart from the
   * current document's list. `frameKey` is the identity the frame derives from
   * its own URL (the only one trusted to replace a placeholder).
   *
   * Returns whether the publish was applied — false for a stale retraction
   * (ignored): the caller must then leave the frame's state (its captures) alone.
   */
  function publish(
    tabId: number,
    frameId: number,
    videos: FrameList,
    docId?: string,
    frameKey?: string | null,
  ): boolean {
    const known = framesByTab.get(tabId);
    const frames = known ?? new Map<number, FrameList>();
    const meta = metaByTab.get(tabId) ?? new Map<number, FrameMeta>();
    const previous = meta.get(frameId);
    const staleRetraction =
      videos.length === 0 && !!docId && !!previous?.docId && previous.docId !== docId;
    live.add(tabId);
    // A republish of the same list (report requests, verify after every
    // `complete`) leaves the mirror as it is: no storage write.
    const unchanged =
      known != null && (staleRetraction || sameList(frames.get(frameId) ?? [], videos));
    const keys = keysByTab.get(tabId) ?? new Map<number, string>();
    let keyChanged = false;
    const publishSeq = ++seq;
    if (!staleRetraction) {
      setFrameVideos(frames, frameId, videos);
      if (videos.length) meta.set(frameId, { docId, seq: publishSeq });
      else meta.delete(frameId);
      const nextKey = videos.length && frameKey ? frameKey : undefined;
      keyChanged = keys.get(frameId) !== nextKey;
      if (nextKey) keys.set(frameId, nextKey);
      else keys.delete(frameId);
    }
    framesByTab.set(tabId, frames);
    metaByTab.set(tabId, meta);
    keysByTab.set(tabId, keys);
    if (!unchanged || keyChanged) persist(tabId);
    resolveWaiters(tabId);
    // Restored entries may describe frames that are gone: confirm them (this
    // publish, from the frame's current document, already counts as refreshed).
    if (restored.delete(tabId)) void verify(tabId, publishSeq - 1);
    else if (verifying.has(tabId) && allRefreshed(tabId)) resolveVerifyWaiters(tabId);
    return !staleRetraction;
  }

  /**
   * True when every frame entry of the tab was republished since the
   * verification in flight started: its sweep would drop nothing, the list is
   * already verified.
   */
  function allRefreshed(tabId: number): boolean {
    const since = verifying.get(tabId)?.since;
    if (since == null) return true;
    const meta = metaByTab.get(tabId);
    for (const frameId of framesByTab.get(tabId)?.keys() ?? []) {
      if ((meta?.get(frameId)?.seq ?? 0) <= since) return false;
    }
    return true;
  }

  function resolveVerifyWaiters(tabId: number): void {
    const list = verifyWaiters.get(tabId);
    if (!list) return;
    verifyWaiters.delete(tabId);
    for (const fn of list) fn();
  }

  /**
   * Resolves once the tab's verification in flight has settled (its sweep ran,
   * or every frame already republished), or after `timeoutMs` — at once when
   * none is in flight.
   */
  function waitForVerify(tabId: number, timeoutMs: number): Promise<void> {
    if (!verifying.has(tabId) || allRefreshed(tabId)) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const list = verifyWaiters.get(tabId) ?? [];
      list.push(() => {
        clearTimeout(timer);
        resolve();
      });
      verifyWaiters.set(tabId, list);
    });
  }

  function forget(tabId: number): void {
    framesByTab.delete(tabId);
    keysByTab.delete(tabId);
    metaByTab.delete(tabId);
    restored.delete(tabId);
    verifying.delete(tabId);
    resolveVerifyWaiters(tabId);
    live.delete(tabId);
    asked.delete(tabId);
    persist(tabId);
  }

  /**
   * Asks every frame to republish, then — after {@link VERIFY_MS} — drops the
   * frame entries nobody refreshed (their document is gone or no longer has a
   * video). Resolves with whether a content script received the request; with
   * none at all, every entry older than the request is dropped. A newer verification of the
   * same tab supersedes an older one.
   */
  async function verify(tabId: number, sinceSeq?: number): Promise<boolean> {
    const token = ++seq;
    const since = sinceSeq ?? token;
    verifying.set(tabId, { token, since });
    const delivered = await requestReport(tabId);
    setTimeout(() => sweep(tabId, token, since, delivered), VERIFY_MS);
    return delivered;
  }

  function sweep(tabId: number, token: number, since: number, delivered: boolean): void {
    if (verifying.get(tabId)?.token !== token) return;
    verifying.delete(tabId);
    try {
      dropUnrefreshed(tabId, since, delivered);
    } finally {
      resolveVerifyWaiters(tabId);
    }
  }

  function dropUnrefreshed(tabId: number, since: number, delivered: boolean): void {
    const frames = framesByTab.get(tabId);
    if (!frames) {
      // Verified empty by its content scripts: an (empty) entry in the mirror
      // tells a restarted worker so, and spares the popup the report wait
      // (listForTab). One write per tab — later sweeps find the entry and
      // stay silent. A tab without content script (extension or browser
      // page) is not marked: asking it fails at once, no wait to spare.
      if (delivered) {
        framesByTab.set(tabId, new Map());
        persist(tabId);
      }
      return;
    }
    const meta = metaByTab.get(tabId);
    let changed = false;
    for (const frameId of [...frames.keys()]) {
      // A frame that published after the request is live — even when the request
      // reached nobody (content scripts injected after `complete`).
      if ((meta?.get(frameId)?.seq ?? 0) > since) continue;
      frames.delete(frameId);
      meta?.delete(frameId);
      keysByTab.get(tabId)?.delete(frameId);
      changed = true;
    }
    if (changed) persist(tabId);
  }

  /**
   * Resolves shortly after the first publish for the tab, or after `timeoutMs`.
   * (Not on `live` already set: callers invoke it right after requesting a report.)
   */
  function waitForPublish(tabId: number, timeoutMs = REPORT_WAIT_MS): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      const list = waiters.get(tabId) ?? [];
      list.push(() => setTimeout(finish, SETTLE_MS));
      waiters.set(tabId, list);
    });
  }

  /** Asks every frame of the tab to publish. False when no content script is there. */
  async function requestReport(tabId: number): Promise<boolean> {
    asked.add(tabId);
    try {
      await deps.sendToTab(tabId, { type: 'REPORT_VIDEOS' });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return !NO_RECEIVER.test(message);
    }
  }

  return {
    ready,
    publish,
    forget,
    verify,
    requestReport,
    waitForPublish,
    /** Merged list of the tab as currently known (no waiting). */
    videosForTab(tabId: number): DetectedVideo[] {
      return merged(tabId);
    },
    /**
     * List for the popup. A tab with no fresh data (worker restarted, nothing
     * published yet) is asked to report, once, and waited on briefly. While a
     * verification of the tab is in flight (navigation just completed), its
     * entries may still be the previous page's: the list waits for it —
     * bounded, and released early once every frame has republished.
     */
    async listForTab(tabId: number): Promise<DetectedVideo[]> {
      await ready;
      if (verifying.has(tabId)) {
        await waitForVerify(tabId, VERIFY_MS + VERIFY_GRACE_MS);
        return merged(tabId);
      }
      if (!live.has(tabId) && !asked.has(tabId)) {
        if (restored.has(tabId)) {
          // The mirror is what this worker's memory would hold had it not
          // been stopped (every publish and sweep is mirrored, and content
          // scripts wake the worker to publish): answer from it at once. The
          // frames are still asked to republish — the first answer verifies
          // the restored entries (publish), for the next list.
          void requestReport(tabId);
        } else {
          // Register before sending so a fast publish cannot be missed; when no
          // content script is there the wait just expires unobserved.
          const wait = waitForPublish(tabId);
          if (await requestReport(tabId)) await wait;
        }
      }
      return merged(tabId);
    },
  };

  function merged(tabId: number): DetectedVideo[] {
    return mergeFrameVideos(framesByTab.get(tabId) ?? new Map(), keysByTab.get(tabId));
  }
}

export type TabVideos = ReturnType<typeof createTabVideos>;
