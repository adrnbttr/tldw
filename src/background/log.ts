import { createLogger } from '@/shared/logger';
import { createLogStore } from './log-store';

/**
 * The worker's logging spine.
 *
 * The service worker is the single writer of the central log buffer: every
 * other context ships its redacted lines over `LOG` messages (see
 * `shared/logger-client.ts`) and only this store persists them, debounced,
 * into `chrome.storage.local`. SW modules import `log` from here — never
 * their own sink.
 */

/** The one log store — owned by the worker, written by no other context. */
export const logStore = createLogStore(chrome.storage.local);

/** The worker's own `sw`-stamped logger. */
export const log = createLogger('sw', logStore.append);
