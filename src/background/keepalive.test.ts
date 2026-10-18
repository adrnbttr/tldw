import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEEPALIVE_INTERVAL_MS, holdKeepalive } from './keepalive';

const getPlatformInfo = vi.fn(async () => ({}));

beforeEach(() => {
  vi.useFakeTimers();
  getPlatformInfo.mockClear();
  vi.stubGlobal('chrome', { runtime: { getPlatformInfo } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('holdKeepalive', () => {
  it('pings an extension API every 20 s while held, then stops', () => {
    const release = holdKeepalive();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 3);
    expect(getPlatformInfo).toHaveBeenCalledTimes(3);
    release();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 3);
    expect(getPlatformInfo).toHaveBeenCalledTimes(3);
  });

  it('stays on until the last holder releases (one timer for all)', () => {
    const a = holdKeepalive();
    const b = holdKeepalive();
    a();
    a(); // idempotent — must not release b's hold
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    expect(getPlatformInfo).toHaveBeenCalledTimes(1);
    b();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 2);
    expect(getPlatformInfo).toHaveBeenCalledTimes(1);
  });
});
