import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression (v0.4.0 RC review): the Vimeo player-config lookup had neither
 * the job's signal nor a timeout — a stalled host pinned the job (and its
 * queue slot) and a cancel did not stop it.
 */
let seen: AbortSignal | undefined;
beforeEach(() => {
  vi.resetModules();
  seen = undefined;
  vi.stubGlobal('chrome', { runtime: { id: 'ext', onMessage: { addListener() {} } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          seen = init.signal;
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('vimeoSources', () => {
  it('gives up after its timeout', async () => {
    vi.useFakeTimers();
    const { vimeoSources, VIMEO_CONFIG_TIMEOUT_MS } = await import('./index');
    const p = vimeoSources('123');
    await vi.advanceTimersByTimeAsync(VIMEO_CONFIG_TIMEOUT_MS);
    expect(await p).toEqual([]);
    expect(seen?.aborted).toBe(true);
  });

  it("stops at once when the job's signal aborts", async () => {
    const { vimeoSources } = await import('./index');
    const job = new AbortController();
    const p = vimeoSources('123', job.signal);
    job.abort();
    expect(await p).toEqual([]);
    expect(seen?.aborted).toBe(true);
  });
});
