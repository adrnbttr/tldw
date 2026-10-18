import type { JobState, Summary } from '@/types';
import { ERROR_MESSAGES } from '@/types';
import type { VideoRef } from '@/storage';

/**
 * Persistence of in-flight job state across MV3 service-worker restarts (F2).
 *
 * The worker can be killed at any moment (~30s idle; jobs hold a keepalive —
 * background/keepalive.ts — but a crash or update still kills it).
 * `chrome.storage.session` survives worker restarts but not browser restarts —
 * exactly the horizon an in-flight job needs. The orchestrator writes the
 * snapshot on every state change (`commit`), and a revived worker replays it
 * before answering any job request (`restoreJobs`, awaited by every handler):
 * a job that was still `running` when its predecessor died is reported as
 * INTERRUPTED instead of silently vanishing into `idle`, and the stable video
 * key stored with it lets the popup show that state on the matching video
 * after a re-scan (fresh local ids) and offer to relaunch it. A running job is
 * never resumed — its streams, timers and offscreen work died with the worker.
 *
 * Size: a done job is persisted as a reference to its cached summary
 * (`StoredJobState`), never the summary itself — the snapshot is rewritten
 * up to every 2 s and must stay small. A done job whose summary was not
 * cached (unattributable or partial audio) is not persisted at all.
 */

/** Where a done job's summary lives in the history cache (storage/index.ts). */
export interface CachedSummaryRef {
  provider: string;
  externalId: string;
  ref: VideoRef;
  /**
   * Exact history key of the summary — set for summaries saved outside the
   * cache (`nocache:` entries: partial or unattributable audio), which no
   * cache lookup can find.
   */
  historyKey?: string;
}

/**
 * A job state as written to storage: like `JobState`, except that a done job
 * carries a reference to its cached summary instead of the summary (`summary`
 * is only found in snapshots written by older builds).
 */
export type StoredJobState =
  | Exclude<JobState, { phase: 'done' }>
  | { phase: 'done'; videoId: string; summary?: Summary; cached?: CachedSummaryRef };

/** What the store holds (see `JobsSnapshot` for the live, in-memory shape). */
export interface StoredSnapshot {
  jobs: Record<string, StoredJobState>;
  lastJobId: string | null;
  keys?: Record<string, string>;
}

/** Serializable mirror of the orchestrator's in-memory state. */
export interface JobsSnapshot {
  jobs: Record<string, JobState>;
  lastJobId: string | null;
  /**
   * Job id → stable video key (shared/video-key.ts). Optional: snapshots
   * written by an older build lack it.
   */
  keys?: Record<string, string>;
}

export interface JobStore {
  load(): Promise<StoredSnapshot>;
  save(snapshot: StoredSnapshot): Promise<void>;
}

const SNAPSHOT_KEY = 'tldw.jobs';

export const EMPTY_SNAPSHOT: JobsSnapshot = { jobs: {}, lastJobId: null };

/** Pure — build the single value written to storage from the live maps. */
export function snapshotOf(
  jobs: Map<string, JobState>,
  lastJobId: string | null,
  keys?: Map<string, string>,
): JobsSnapshot {
  return keys
    ? { jobs: Object.fromEntries(jobs), lastJobId, keys: Object.fromEntries(keys) }
    : { jobs: Object.fromEntries(jobs), lastJobId };
}

/**
 * Pure recovery pass: a persisted `running` job cannot resume (its streams and
 * abort controllers died with the old worker), so it is converted to a typed
 * INTERRUPTED error the popup can render with the usual retry affordance.
 * Terminal states pass through untouched. Idempotent.
 */
export function markInterrupted(snapshot: StoredSnapshot): StoredSnapshot {
  const jobs: Record<string, StoredJobState> = {};
  for (const [videoId, state] of Object.entries(snapshot.jobs)) {
    jobs[videoId] =
      state.phase === 'running'
        ? {
            phase: 'error',
            videoId,
            code: 'INTERRUPTED',
            message: ERROR_MESSAGES.INTERRUPTED,
          }
        : state;
  }
  return snapshot.keys
    ? { jobs, lastJobId: snapshot.lastJobId, keys: snapshot.keys }
    : { jobs, lastJobId: snapshot.lastJobId };
}

/** Adapter over `chrome.storage.session` — one key holds the whole snapshot. */
export const sessionJobStore: JobStore = {
  async load(): Promise<StoredSnapshot> {
    const stored = await chrome.storage.session.get(SNAPSHOT_KEY);
    return (stored[SNAPSHOT_KEY] as StoredSnapshot | undefined) ?? EMPTY_SNAPSHOT;
  },

  async save(snapshot: StoredSnapshot): Promise<void> {
    await chrome.storage.session.set({ [SNAPSHOT_KEY]: snapshot });
  },
};
