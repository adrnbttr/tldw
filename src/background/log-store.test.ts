import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LogEntry } from '@/shared/logger';
import type { LogStore, StorageArea } from './log-store';
import { LOGS_KEY, createLogStore } from './log-store';

const entry = (msg: string, t = 0, level: LogEntry['level'] = 'info'): LogEntry => ({
  t,
  level,
  source: 'sw',
  msg,
});

/** Minimal in-memory chrome.storage.local fake. */
const makeArea = () => {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string): Promise<Record<string, unknown>> =>
      data.has(key) ? { [key]: data.get(key) } : {},
    ),
    set: vi.fn(async (items: Record<string, unknown>): Promise<void> => {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    }),
    remove: vi.fn(async (key: string): Promise<void> => {
      data.delete(key);
    }),
  };
};

describe('createLogStore', () => {
  let area: ReturnType<typeof makeArea>;
  let store: LogStore;

  beforeEach(() => {
    vi.useFakeTimers();
    area = makeArea();
    store = createLogStore(area);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups a burst of appends into a single write once the debounce window closes', async () => {
    for (let i = 0; i < 10; i++) store.append(entry(`m${i}`));

    expect(area.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(area.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(area.set).toHaveBeenCalledOnce();
    expect(area.set).toHaveBeenCalledWith({
      [LOGS_KEY]: [
        entry('m0'),
        entry('m1'),
        entry('m2'),
        entry('m3'),
        entry('m4'),
        entry('m5'),
        entry('m6'),
        entry('m7'),
        entry('m8'),
        entry('m9'),
      ],
    });
    expect((await store.readAll()).map((l) => l.msg)).toEqual(
      Array.from({ length: 10 }, (_, i) => `m${i}`),
    );
  });

  it('re-arms the debounce window on each append', async () => {
    store.append(entry('a'));
    await vi.advanceTimersByTimeAsync(400);
    store.append(entry('b'));
    await vi.advanceTimersByTimeAsync(400);
    expect(area.set).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(area.set).toHaveBeenCalledOnce();
  });

  it('caps the stored history at 500 entries, keeping the newest', async () => {
    for (let i = 0; i < 600; i++) store.append(entry(`m${i}`));
    await vi.advanceTimersByTimeAsync(500);

    const logs = await store.readAll();
    expect(logs).toHaveLength(500);
    expect(logs[0].msg).toBe('m100');
    expect(logs.at(-1)?.msg).toBe('m599');
  });

  it('honors a custom capacity', async () => {
    const small = createLogStore(area, { capacity: 3 });
    for (const m of ['a', 'b', 'c', 'd']) small.append(entry(m));
    await vi.advanceTimersByTimeAsync(500);

    expect((await small.readAll()).map((l) => l.msg)).toEqual(['b', 'c', 'd']);
  });

  it('caps the merged history at the capacity across flushes', async () => {
    const small = createLogStore(area, { capacity: 3 });
    for (const m of ['a', 'b', 'c']) small.append(entry(m));
    await vi.advanceTimersByTimeAsync(500);
    for (const m of ['d', 'e', 'f']) small.append(entry(m));
    await vi.advanceTimersByTimeAsync(500);

    expect((await small.readAll()).map((l) => l.msg)).toEqual(['d', 'e', 'f']);
  });

  /** ~1 KiB serialized per entry — sized to make the byte budget bite. */
  const big = (m: string): LogEntry => ({
    t: 0,
    level: 'info',
    source: 'sw',
    msg: m,
    data: 'x'.repeat(1000),
  });

  it('bounds the persisted buffer by serialized bytes, evicting the oldest', async () => {
    const small = createLogStore(area, { capacity: 10, budgetBytes: 2400 });
    for (const m of ['a', 'b', 'c', 'd']) small.append(big(m));
    await vi.advanceTimersByTimeAsync(500);

    // Only the newest ~2 KiB fit the budget — the oldest entries are evicted.
    expect((await small.readAll()).map((l) => l.msg)).toEqual(['c', 'd']);
    const persisted = area.set.mock.calls.at(-1)?.[0]?.[LOGS_KEY] as LogEntry[];
    expect(JSON.stringify(persisted).length).toBeLessThanOrEqual(2400);
  });

  it('trims the merged history back under the byte budget across flushes', async () => {
    const small = createLogStore(area, { capacity: 10, budgetBytes: 2400 });
    for (const m of ['a', 'b']) small.append(big(m));
    await vi.advanceTimersByTimeAsync(500); // both fit, stored
    for (const m of ['c', 'd']) small.append(big(m));
    await vi.advanceTimersByTimeAsync(500); // merged history exceeds — trimmed

    expect((await small.readAll()).map((l) => l.msg)).toEqual(['c', 'd']);
  });

  it('evicts an unserializable entry instead of wedging every future write', async () => {
    const poisoned: LogEntry = { t: 0, level: 'info', source: 'sw', msg: 'boom', data: { n: 10n } };
    store.append(poisoned);
    store.append(entry('after'));
    await vi.advanceTimersByTimeAsync(500);

    expect(area.set).toHaveBeenCalledOnce();
    expect(await store.readAll()).toEqual([entry('after')]);
  });

  it('flushes error entries immediately, without waiting for the debounce', async () => {
    store.append(entry('boom', 0, 'error'));
    await store.readAll(); // awaits the in-flight flush chain

    expect(area.set).toHaveBeenCalledOnce();
    expect((await store.readAll()).map((l) => l.msg)).toEqual(['boom']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(area.set).toHaveBeenCalledOnce(); // no leftover debounce flush
  });

  it('an immediate error flush folds in the already queued entries', async () => {
    store.append(entry('info line'));
    store.append(entry('boom', 1, 'error'));
    await store.readAll();

    expect(area.set).toHaveBeenCalledOnce();
    expect((await store.readAll()).map((l) => l.msg)).toEqual(['info line', 'boom']);
  });

  it('flushes warn entries immediately too, without waiting for the debounce', async () => {
    store.append(entry('careful', 0, 'warn'));
    await store.readAll(); // awaits the in-flight flush chain

    expect(area.set).toHaveBeenCalledOnce();
    expect((await store.readAll()).map((l) => l.msg)).toEqual(['careful']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(area.set).toHaveBeenCalledOnce(); // no leftover debounce flush
  });

  it('readAll folds queued entries into the stored history, chronologically', async () => {
    store.append(entry('a'));
    await vi.advanceTimersByTimeAsync(500);
    store.append(entry('b'));

    expect(await store.readAll()).toEqual([entry('a'), entry('b')]);
  });

  it('clear drops stored and queued entries and cancels the armed flush', async () => {
    store.append(entry('a'));
    await vi.advanceTimersByTimeAsync(500);
    expect(area.set).toHaveBeenCalledOnce();

    store.append(entry('b'));
    await store.clear();

    expect(area.remove).toHaveBeenCalledWith(LOGS_KEY);
    expect(await store.readAll()).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(area.set).toHaveBeenCalledOnce();
  });

  it('a failing write is silent and its batch is retried later', async () => {
    area.set.mockRejectedValueOnce(new Error('QUOTA_BYTES'));

    expect(() => store.append(entry('a'))).not.toThrow();
    await vi.advanceTimersByTimeAsync(500);
    expect(await store.readAll()).toEqual([entry('a')]);

    store.append(entry('b'));
    await vi.advanceTimersByTimeAsync(500);

    expect(area.set).toHaveBeenCalledTimes(2);
    expect(await store.readAll()).toEqual([entry('a'), entry('b')]);
  });

  it('retries failed writes on the debounce cadence and never lets pending grow', async () => {
    area.set.mockRejectedValue(new Error('QUOTA_BYTES'));
    const small = createLogStore(area, { capacity: 3 });

    for (const m of ['a', 'b', 'c']) small.append(entry(m));
    await vi.advanceTimersByTimeAsync(500);
    expect(area.set).toHaveBeenCalledTimes(1); // first attempt failed

    await vi.advanceTimersByTimeAsync(500);
    expect(area.set).toHaveBeenCalledTimes(2); // the failure re-armed the flush

    for (let i = 0; i < 8; i++) small.append(entry(`x${i}`));
    const logs = await small.readAll();
    expect(logs).toHaveLength(3); // pending is capped at the capacity
    expect(logs.at(-1)?.msg).toBe('x7');
  });

  it('drops the batch after 3 consecutive failed flushes, without requeueing forever', async () => {
    area.set.mockRejectedValue(new Error('QUOTA_BYTES'));
    store.append(entry('a'));
    await vi.advanceTimersByTimeAsync(500); // failure #1 — requeued
    await vi.advanceTimersByTimeAsync(500); // failure #2 — requeued
    await vi.advanceTimersByTimeAsync(500); // failure #3 — dropped
    expect(area.set).toHaveBeenCalledTimes(3);

    expect(await store.readAll()).toEqual([]); // the batch is gone
    await vi.advanceTimersByTimeAsync(5000);
    expect(area.set).toHaveBeenCalledTimes(3); // no further retries

    // A fresh batch gets a fresh attempt count — the drop reset it.
    store.append(entry('b'));
    await vi.advanceTimersByTimeAsync(500); // failure #1 of the new batch
    expect(area.set).toHaveBeenCalledTimes(4);
    expect(await store.readAll()).toEqual([entry('b')]); // requeued, not dropped
  });

  it('drops the batch on the first failure when maxFlushAttempts is 1', async () => {
    area.set.mockRejectedValue(new Error('QUOTA_BYTES'));
    const strict = createLogStore(area, { maxFlushAttempts: 1 });
    strict.append(entry('a'));
    await vi.advanceTimersByTimeAsync(500);

    expect(area.set).toHaveBeenCalledOnce();
    expect(await strict.readAll()).toEqual([]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(area.set).toHaveBeenCalledOnce(); // dropped, never requeued
  });

  it('readAll skips invalid entries found in storage', async () => {
    await area.set({
      [LOGS_KEY]: [
        entry('ok'),
        { t: 'x', level: 'info', source: 'sw', msg: 'bad t' },
        { t: 1, level: 'loud', source: 'sw', msg: 'bad level' },
        'junk',
        null,
      ],
    });

    expect(await store.readAll()).toEqual([entry('ok')]);
  });

  it('serializes overlapping flushes so no entries are lost', async () => {
    const data = new Map<string, unknown>();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let firstGet = true;
    const gatedArea: StorageArea = {
      get: async (key) => {
        order.push('get');
        const out = data.has(key) ? { [key]: data.get(key) } : {};
        if (firstGet) {
          firstGet = false;
          await gate;
        }
        return out;
      },
      set: async (items) => {
        for (const [key, value] of Object.entries(items)) data.set(key, value);
        order.push('set');
      },
      remove: async (key) => {
        data.delete(key);
      },
    };
    const gated = createLogStore(gatedArea);

    gated.append(entry('a'));
    vi.advanceTimersByTime(500); // flush #1 starts and parks on the gated get
    await Promise.resolve();
    expect(order).toEqual(['get']);

    const secondFlush = gated.flush(); // must queue behind, not overlap
    gated.append(entry('b')); // lands after flush #1 captured its batch
    expect(order).toEqual(['get']);

    release();
    await secondFlush;

    expect(order).toEqual(['get', 'set', 'get', 'set']);
    expect((await gated.readAll()).map((l) => l.msg)).toEqual(['a', 'b']);
  });

  it('runs on injected timer functions when provided', async () => {
    const armed: Array<() => void> = [];
    let canceled = 0;
    const manual = createLogStore(area, {
      setTimeout: (handler) => {
        armed.push(handler);
        return armed.length;
      },
      clearTimeout: () => {
        canceled += 1;
      },
    });

    manual.append(entry('a'));
    manual.append(entry('b'));
    // first append: debounce + max-wait; second re-arms only the debounce.
    expect(armed).toHaveLength(3);
    expect(canceled).toBe(1);

    armed[armed.length - 1]();
    await manual.flush();

    expect((await manual.readAll()).map((l) => l.msg)).toEqual(['a', 'b']);
  });

  it('skips an unfit newest entry instead of persisting nothing', async () => {
    const small = createLogStore(area, { capacity: 10, budgetBytes: 2400 });
    small.append(big('old'));
    small.append({ ...big('huge'), data: 'x'.repeat(5000) });
    await vi.advanceTimersByTimeAsync(500);

    expect((await small.readAll()).map((l) => l.msg)).toEqual(['old']);
  });

  it('keeps older entries when the newest one is unserializable', async () => {
    store.append(entry('old'));
    store.append({ t: 0, level: 'info', source: 'sw', msg: 'boom', data: { n: 10n } });
    await vi.advanceTimersByTimeAsync(500);

    expect((await store.readAll()).map((l) => l.msg)).toEqual(['old']);
  });

  it('persists a steady stream within the max wait, even if the debounce keeps restarting', async () => {
    for (let i = 0; i < 12; i++) {
      store.append(entry(`m${i}`));
      await vi.advanceTimersByTimeAsync(400); // never lets the 500 ms debounce close
    }
    expect(area.set).toHaveBeenCalled();
    const persisted = area.set.mock.calls[0][0][LOGS_KEY] as LogEntry[];
    expect(persisted.length).toBeGreaterThan(0);
  });
});
