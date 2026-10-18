import type { JobState } from '@/types';

type ErrorState = Extract<JobState, { phase: 'error' }>;

/**
 * Rate-limit countdown (RATE_LIMITED + `retryAfter`).
 *
 * The countdown runs from an absolute instant — `failedAt + retryAfter` — so
 * it keeps ticking down while the popup is open and is still right after the
 * popup is closed and reopened. States from an older worker carry no
 * `failedAt`: `stampFailedAt` dates them on receipt instead (best effort).
 */

/** Adds `failedAt = now` to an error state with a `retryAfter` but no date. */
export function stampFailedAt(state: JobState, now: number): JobState {
  if (state.phase !== 'error' || state.retryAfter == null || state.failedAt != null) return state;
  return { ...state, failedAt: now };
}

/** Epoch ms at which retrying makes sense again, or null when there is no wait. */
export function retryAt(state: ErrorState): number | null {
  if (state.retryAfter == null || !Number.isFinite(state.retryAfter) || state.failedAt == null) {
    return null;
  }
  return state.failedAt + state.retryAfter * 1000;
}

/** Whole seconds left before `at` (rounded up), or null once it has passed. */
export function secondsLeft(at: number | null, now: number): number | null {
  if (at == null) return null;
  const left = Math.ceil((at - now) / 1000);
  return left > 0 ? left : null;
}
