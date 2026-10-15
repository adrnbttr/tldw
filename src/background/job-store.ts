import type { JobState } from '@/types';
import { ERROR_MESSAGES } from '@/types';

/**
 * Persistence of in-flight job state across MV3 service-worker restarts (F2).
 *
 * The worker can be killed at any moment (~30s idle). `chrome.storage.session`
 * survives worker restarts but not browser restarts — exactly the horizon an
 * in-flight job needs: a revived worker replays the snapshot, and any job that
 * was still `running` when its predecessor died is reported as INTERRUPTED
 * instead of silently vanishing into `idle`.
 */

/** Serializable mirror of the orchestrator's in-memory state. */
export interface JobsSnapshot {
  jobs: Record<string, JobState>;
  lastJobId: string | null;
}

export interface JobStore {
  load(): Promise<JobsSnapshot>;
  save(snapshot: JobsSnapshot): Promise<void>;
}

const SNAPSHOT_KEY = 'tldw.jobs';

export const EMPTY_SNAPSHOT: JobsSnapshot = { jobs: {}, lastJobId: null };

/** Pure — build the single value written to storage from the live maps. */
export function snapshotOf(jobs: Map<string, JobState>, lastJobId: string | null): JobsSnapshot {
  return { jobs: Object.fromEntries(jobs), lastJobId };
}

/**
 * Pure recovery pass: a persisted `running` job cannot resume (its streams and
 * abort controllers died with the old worker), so it is converted to a typed
 * INTERRUPTED error the popup can render with the usual retry affordance.
 * Terminal states pass through untouched. Idempotent.
 */
export function markInterrupted(snapshot: JobsSnapshot): JobsSnapshot {
  const jobs: Record<string, JobState> = {};
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
  return { jobs, lastJobId: snapshot.lastJobId };
}

/** Adapter over `chrome.storage.session` — one key holds the whole snapshot. */
export const sessionJobStore: JobStore = {
  async load(): Promise<JobsSnapshot> {
    const stored = await chrome.storage.session.get(SNAPSHOT_KEY);
    return (stored[SNAPSHOT_KEY] as JobsSnapshot | undefined) ?? EMPTY_SNAPSHOT;
  },

  async save(snapshot: JobsSnapshot): Promise<void> {
    await chrome.storage.session.set({ [SNAPSHOT_KEY]: snapshot });
  },
};
