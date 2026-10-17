import type { LogEntry } from '@/shared/logger';
import { DEFAULT_LOG_CAPACITY, isLogEntry, pushBounded } from '@/shared/logger';

/**
 * Bounded, debounced persistence of the log buffer into `chrome.storage.local`.
 *
 * Appends pile up in memory (never past the capacity) and land in storage as
 * one grouped write per debounce window; warn and error entries skip the
 * debounce. The persisted buffer is bounded twice — by entry count (capacity)
 * and by serialized bytes (budget) — the oldest entries evicted first.
 * Storage is best-effort for logs: a failing write is swallowed and its batch
 * requeued, but only a few times running — a batch that keeps failing is
 * dropped, so logging never wedges the worker on a broken store. Overlapping
 * flushes serialize on a single chain so a burst never loses entries.
 */

export const LOGS_KEY = 'tldw.logs';

/** Serialized byte budget of the persisted buffer — ~256 KiB. */
export const DEFAULT_LOG_BUDGET_BYTES = 256 * 1024;

/** Consecutive failed flush attempts before the batch is dropped. */
export const DEFAULT_MAX_FLUSH_ATTEMPTS = 3;

/** Minimal storage surface — satisfied by `chrome.storage.local`. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface LogStoreOptions {
  debounceMs?: number;
  capacity?: number;
  /** Serialized byte budget of the persisted buffer (default ~256 KiB). */
  budgetBytes?: number;
  /** Consecutive failed flush attempts before the batch is dropped (default 3). */
  maxFlushAttempts?: number;
  setTimeout?: (handler: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

export interface LogStore {
  append(entry: LogEntry): void;
  readAll(): Promise<LogEntry[]>;
  clear(): Promise<void>;
  flush(): Promise<void>;
}

/**
 * Serialized size of one entry, plus the list separator that joins it; an
 * entry that can't be serialized counts as infinite — it is always evicted,
 * else it would poison (and unship) the whole persisted write.
 */
function entryBytes(entry: LogEntry): number {
  try {
    return JSON.stringify(entry).length + 1;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Trims a list to the serialized byte budget, evicting the oldest entries:
 * keeps the newest entries whose cumulative size fits (the JSON brackets, net
 * of one separator, seed the count), so the trimmed list serializes within
 * the budget — or empty, when even the newest entry can't fit.
 */
function trimToByteBudget(entries: readonly LogEntry[], budgetBytes: number): LogEntry[] {
  let acc = 1;
  let start = entries.length;
  while (start > 0) {
    const size = entryBytes(entries[start - 1]);
    if (!Number.isFinite(size) || acc + size > budgetBytes) break;
    acc += size;
    start -= 1;
  }
  return entries.slice(start);
}

export function createLogStore(area: StorageArea, opts: LogStoreOptions = {}): LogStore {
  const debounceMs = opts.debounceMs ?? 500;
  const capacity = opts.capacity ?? DEFAULT_LOG_CAPACITY;
  const budgetBytes = opts.budgetBytes ?? DEFAULT_LOG_BUDGET_BYTES;
  const maxAttempts = opts.maxFlushAttempts ?? DEFAULT_MAX_FLUSH_ATTEMPTS;
  const schedule =
    opts.setTimeout ?? ((handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number);
  const cancelTimer = opts.clearTimeout ?? ((id) => globalThis.clearTimeout(id));

  let pending: LogEntry[] = [];
  let timer: number | null = null;
  let tail: Promise<void> = Promise.resolve();
  let attempts = 0; // consecutive failed flushes of the pending batch

  /** Runs storage tasks one at a time; a failure never poisons the chain. */
  const serialize = (task: () => Promise<void>): Promise<void> => {
    const run = tail.then(task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const cancelScheduled = (): void => {
    if (timer !== null) {
      cancelTimer(timer);
      timer = null;
    }
  };

  const arm = (): void => {
    if (timer !== null) return;
    timer = schedule(() => {
      timer = null;
      void serialize(doFlush);
    }, debounceMs);
  };

  const readStored = async (): Promise<LogEntry[]> => {
    const stored = await area.get(LOGS_KEY);
    const raw = stored[LOGS_KEY];
    // Untrusted storage — corrupt or stale entries are filtered, not cast.
    return Array.isArray(raw) ? raw.filter(isLogEntry) : [];
  };

  const doFlush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    try {
      const merged = trimToByteBudget(
        [...(await readStored()), ...batch].slice(-capacity),
        budgetBytes,
      );
      await area.set({ [LOGS_KEY]: merged });
      attempts = 0;
    } catch {
      attempts += 1;
      if (attempts < maxAttempts) {
        // Best-effort store — requeue the batch, retry on the debounce cadence.
        pending = [...batch, ...pending].slice(-capacity);
        arm();
        return;
      }
      // The batch keeps failing — drop it rather than requeueing it forever;
      // entries appended meanwhile keep a fresh window (and a fresh count).
      attempts = 0;
      if (pending.length > 0) arm();
    }
  };

  return {
    append(entry) {
      pending = pushBounded(pending, entry, capacity);
      if (entry.level === 'warn' || entry.level === 'error') {
        // Warn and error skip the debounce — the worker can die at any
        // moment, and its last words are the ones worth persisting first.
        cancelScheduled();
        void serialize(doFlush);
        return;
      }
      cancelScheduled();
      arm();
    },

    async readAll() {
      // An in-flight flush owns entries neither in storage nor in pending.
      await tail;
      return [...(await readStored()), ...pending];
    },

    clear() {
      return serialize(async () => {
        cancelScheduled();
        pending = [];
        await area.remove(LOGS_KEY);
      });
    },

    flush() {
      return serialize(async () => {
        cancelScheduled();
        await doFlush();
      });
    },
  };
}
