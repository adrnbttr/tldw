import type { LogMessage } from '@/types';
import type { Logger, LogSink, LogSource } from './logger';
import { createLogger } from './logger';

export interface ClientLoggerOptions {
  /**
   * Mirror every entry to the matching `console` method, in addition to
   * shipping it to the worker — the offscreen document keeps its DevTools
   * console as a live debugging surface. The echoed entry is the
   * already-redacted one: no secret ever reaches the console. The worker
   * itself never echoes (it owns the buffer; see `background/log.ts`).
   */
  echo?: boolean;
}

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
export function createClientLogger(
  source: Exclude<LogSource, 'sw'>,
  { echo = false }: ClientLoggerOptions = {},
): Logger {
  const sink: LogSink = (entry) => {
    const message: LogMessage = { type: 'LOG', entry };
    try {
      chrome.runtime.sendMessage(message).catch(() => {
        // No worker listening / context invalidated — drop the line.
      });
    } catch {
      // Synchronous throw from an invalidated context — drop the line.
    }
    // Ship first, echo second: a broken console must never lose the line.
    if (echo) {
      try {
        const args = entry.data === undefined ? [] : [entry.data];
        console[entry.level](`[tldw:${entry.source}]`, entry.msg, ...args);
      } catch {
        // Console unavailable — the line was already shipped.
      }
    }
  };
  return createLogger(source, sink);
}
