import { OFFSCREEN_PORT } from '@/transcription/offscreen-protocol';

/**
 * Liveness link between one offscreen job and the service worker.
 *
 * For the whole job the offscreen document holds a `chrome.runtime.connect`
 * port to the worker. It carries no messages — the worker is kept alive by
 * the job's own keepalive (background/keepalive.ts) — but if the worker dies
 * anyway, the port disconnects and `onLost` fires: the offscreen job aborts
 * instead of spending credits on a result nobody will receive (the restarted
 * worker also closes any orphan document — transcription/offscreen-session.ts).
 */

export interface WorkerLink {
  /** Ends the link on purpose (job finished); `onLost` will not fire. */
  close(): void;
}

export function openWorkerLink(onLost: () => void): WorkerLink {
  const port = chrome.runtime.connect({ name: OFFSCREEN_PORT });
  let closed = false;
  port.onDisconnect.addListener(() => {
    if (!closed) {
      closed = true;
      onLost();
    }
  });
  return {
    close() {
      if (closed) return;
      closed = true;
      port.disconnect();
    },
  };
}
