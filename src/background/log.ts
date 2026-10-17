import { createLogger } from '@/shared/logger';
import { createLogStore } from './log-store';
import type { StorageArea } from './log-store';

/**
 * The worker's logging spine.
 *
 * The service worker is the single writer of the central log buffer: every
 * other context ships its redacted lines over `LOG` messages (see
 * `shared/logger-client.ts`) and only this store persists them, debounced,
 * into `chrome.storage.local`. SW modules import `log` from here — never
 * their own sink.
 */

/**
 * Stands in for `chrome.storage.local` where it does not exist — node test
 * runs load SW modules (media capture, page fetch) without the extension
 * runtime. Importing `log` must never throw: the broken-sink rule,
 * extended to import time.
 */
const voidArea: StorageArea = {
  get: async () => ({}),
  set: async () => undefined,
  remove: async () => undefined,
};

/** The one log store — owned by the worker, written by no other context. */
export const logStore = createLogStore(
  typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : voidArea,
);

/** The worker's own `sw`-stamped logger. */
export const log = createLogger('sw', logStore.append);
