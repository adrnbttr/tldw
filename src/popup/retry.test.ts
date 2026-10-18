import { describe, expect, it } from 'vitest';
import type { JobState } from '@/types';
import { retryAt, secondsLeft, stampFailedAt } from './retry';

const limited = (extra: Partial<Extract<JobState, { phase: 'error' }>> = {}) =>
  ({
    phase: 'error',
    videoId: 'v',
    code: 'RATE_LIMITED',
    message: 'x',
    retryAfter: 37,
    ...extra,
  }) as Extract<JobState, { phase: 'error' }>;

describe('rate-limit countdown', () => {
  it('counts down from the absolute failure time, not from when the popup opened', () => {
    const at = retryAt(limited({ failedAt: 1_000_000 }));
    expect(at).toBe(1_037_000);
    expect(secondsLeft(at, 1_000_000)).toBe(37);
    // Reopened 30 s later: 7 s left, not 37 again.
    expect(secondsLeft(at, 1_030_000)).toBe(7);
    // Rounds up: 0.4 s left still reads "1 s".
    expect(secondsLeft(at, 1_036_600)).toBe(1);
  });

  it('hides the countdown once elapsed', () => {
    const at = retryAt(limited({ failedAt: 1_000_000 }));
    expect(secondsLeft(at, 1_037_000)).toBeNull();
    expect(secondsLeft(at, 2_000_000)).toBeNull();
    expect(secondsLeft(null, 0)).toBeNull();
  });

  it('has no deadline without retryAfter or a failure date', () => {
    expect(retryAt(limited({ retryAfter: undefined, failedAt: 5 }))).toBeNull();
    expect(retryAt(limited())).toBeNull();
  });

  it('stamps undated states on receipt, and only those', () => {
    expect(stampFailedAt(limited(), 42)).toMatchObject({ failedAt: 42 });
    const dated = limited({ failedAt: 7 });
    expect(stampFailedAt(dated, 42)).toBe(dated);
    const noWait = limited({ retryAfter: undefined });
    expect(stampFailedAt(noWait, 42)).toBe(noWait);
    const running: JobState = { phase: 'running', videoId: 'v', steps: [] };
    expect(stampFailedAt(running, 42)).toBe(running);
  });
});
