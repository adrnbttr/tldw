/**
 * Service-worker keepalive for the duration of a job (F2).
 *
 * MV3 stops an idle worker after ~30 s, and a job has long event-less
 * stretches: a slow caption fetch, a summary request, the whole audio
 * fallback. Since Chrome 110 every extension API call resets the idle timer,
 * so while at least one job holds the keepalive a trivial API call runs every
 * 20 s — this covers the audio fallback too. The offscreen document holds a
 * job port (src/offscreen/worker-link.ts) only to notice, and abort, if the
 * worker dies anyway.
 */

export const KEEPALIVE_INTERVAL_MS = 20 * 1000;

let holders = 0;
let timer: ReturnType<typeof setInterval> | undefined;

/** Keeps the worker alive until the returned release function is called (idempotent). */
export function holdKeepalive(): () => void {
  holders++;
  if (holders === 1) {
    timer = setInterval(() => {
      void chrome.runtime.getPlatformInfo().catch(() => {});
    }, KEEPALIVE_INTERVAL_MS);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders--;
    if (holders === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
