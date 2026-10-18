import { TldwError } from '@/types';
import { OFFSCREEN_PATH } from './offscreen-protocol';

/**
 * Worker-side lifecycle of the offscreen document (audio fallback).
 *
 * One offscreen document, one ffmpeg instance, one source file in its FS: audio
 * jobs therefore run strictly one at a time through `audioQueue`. A queued job
 * waits for the slot before it ever touches the document; the document is
 * created on demand (`ensureOffscreen`, concurrency-safe) and closed only when
 * nothing is left in the queue — or right away when a run ends abnormally
 * (cancel, timeout, unreachable document), which kills whatever the offscreen
 * side was still doing before the next job takes the slot.
 */

export interface SerialQueue {
  /** Jobs queued or running. */
  readonly size: number;
  /**
   * Runs `task` once every previously enqueued task has settled. `onQueued`
   * fires (synchronously) when the task has to wait, with the number of tasks
   * ahead of it, and again each time that number drops while it still waits;
   * an abort while waiting rejects with a TIMEOUT "cancelled" error and frees
   * the place in line.
   */
  run<T>(
    task: () => Promise<T>,
    options?: { signal?: AbortSignal; onQueued?: (ahead: number) => void },
  ): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  /** Running task first, then the waiting ones in order. */
  const line: Array<{ onQueued?: (ahead: number) => void }> = [];
  return {
    get size() {
      return line.length;
    },
    run(task, options = {}) {
      const previous = tail;
      let release!: () => void;
      const mine = new Promise<void>((resolve) => (release = resolve));
      tail = previous.then(() => mine);
      const entry = { onQueued: options.onQueued };
      line.push(entry);
      if (line.length > 1) entry.onQueued?.(line.length - 1);
      return (async () => {
        try {
          await untilSettledOrAborted(previous, options.signal);
          return await task();
        } finally {
          line.splice(line.indexOf(entry), 1);
          release();
          // Everyone behind moved up one place; index 0 is about to run.
          for (let i = 1; i < line.length; i++) line[i].onQueued?.(i);
        }
      })();
    },
  };
}

function untilSettledOrAborted(wait: Promise<void>, signal?: AbortSignal): Promise<void> {
  const cancelled = () => new TldwError('TIMEOUT', 'Transcription cancelled.');
  if (signal?.aborted) return Promise.reject(cancelled());
  if (!signal) return wait;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    void wait.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

/** The single audio queue of this worker. */
export const audioQueue = createSerialQueue();

let creating: Promise<void> | null = null;
let reconciled: Promise<void> = Promise.resolve();

/**
 * Worker startup: no job can be live in a fresh worker, so an offscreen
 * document that survived its predecessor is an orphan (possibly still
 * downloading or paying for transcription) — close it. Jobs creating a
 * document wait for this pass first.
 */
export function reconcileOrphanOffscreen(): Promise<void> {
  reconciled = (async () => {
    try {
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    } catch {
      // Already gone — nothing to reconcile.
    }
  })();
  return reconciled;
}

/**
 * Creates the offscreen document unless it exists. Concurrent callers share
 * one in-flight creation, and Chrome's "only a single offscreen document"
 * error (a creation racing ours from elsewhere) counts as success.
 */
export async function ensureOffscreen(): Promise<void> {
  await reconciled;
  if (creating) return creating;
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run ffmpeg.wasm to extract audio for transcription.',
    })
    .catch((err: unknown) => {
      if (/single offscreen document/i.test(String(err))) return;
      throw new TldwError(
        'AUDIO_EXTRACTION_FAILED',
        'Could not open the offscreen document.',
        String(err),
      );
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}

/** Closes the offscreen document; never throws. */
export async function closeOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Not open — fine.
  }
}
