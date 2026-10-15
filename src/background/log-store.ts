import type { LogEntry } from '@/shared/logger';
import { DEFAULT_LOG_CAPACITY, isLogEntry, pushBounded } from '@/shared/logger';

/**
 * Bounded, debounced persistence of the log buffer into `chrome.storage.local`.
 *
 * Appends pile up in memory (never past the capacity) and land in storage as
 * one grouped write per debounce window; error entries skip the debounce.
 * Storage is best-effort for logs: a failing write is swallowed, its batch
 * requeued and the debounce re-armed — logging must never break the worker.
 * Overlapping flushes serialize on a single chain so a burst never loses
 * entries.
 */

export const LOGS_KEY = 'tldw.logs';

/** Minimal storage surface — satisfied by `chrome.storage.local`. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface LogStoreOptions {
  debounceMs?: number;
  capacity?: number;
  setTimeout?: (handler: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

export interface LogStore {
  append(entry: LogEntry): void;
  readAll(): Promise<LogEntry[]>;
  clear(): Promise<void>;
  flush(): Promise<void>;
}

export function createLogStore(area: StorageArea, opts: LogStoreOptions = {}): LogStore {
  const debounceMs = opts.debounceMs ?? 500;
  const capacity = opts.capacity ?? DEFAULT_LOG_CAPACITY;
  const schedule =
    opts.setTimeout ?? ((handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number);
  const cancelTimer = opts.clearTimeout ?? ((id) => globalThis.clearTimeout(id));

  let pending: LogEntry[] = [];
  let timer: number | null = null;
  let tail: Promise<void> = Promise.resolve();

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
      const merged = [...(await readStored()), ...batch].slice(-capacity);
      await area.set({ [LOGS_KEY]: merged });
    } catch {
      // Best-effort store — requeue the batch, retry on the debounce cadence.
      pending = [...batch, ...pending].slice(-capacity);
      arm();
    }
  };

  return {
    append(entry) {
      pending = pushBounded(pending, entry, capacity);
      if (entry.level === 'error') {
        // An error skips the debounce — the worker can die at any moment.
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
