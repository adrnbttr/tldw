import type { LogMessage } from '@/types';
import type { Logger, LogSink, LogSource } from './logger';
import { createLogger } from './logger';

/**
 * Client-side logger for offscreen/content/popup contexts: every entry is
 * redacted by `createLogger`, stamped with `source` and shipped to the
 * service worker as a fire-and-forget `LOG` message — the worker owns the
 * single persistent buffer (SW modules use `background/log.ts` instead).
 *
 * Transport failures are swallowed twice: a synchronous throw (invalidated
 * context) by the try/catch, an asynchronous rejection by the `.catch`.
 * Logging must never break the caller.
 */
export function createClientLogger(source: Exclude<LogSource, 'sw'>): Logger {
  const sink: LogSink = (entry) => {
    const message: LogMessage = { type: 'LOG', entry };
    try {
      chrome.runtime.sendMessage(message).catch(() => {
        // No worker listening / context invalidated — drop the line.
      });
    } catch {
      // Synchronous throw from an invalidated context — drop the line.
    }
  };
  return createLogger(source, sink);
}
