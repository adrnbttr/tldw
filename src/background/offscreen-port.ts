import { OFFSCREEN_PORT } from '@/transcription/offscreen-protocol';

/**
 * Worker side of the offscreen job port (src/offscreen/worker-link.ts).
 *
 * The port carries no messages: it exists so its disconnection tells the
 * offscreen document the worker died. Only our own offscreen document may hold
 * one — any other connection (another extension, a content script, a foreign
 * port name) is dropped at once.
 */
export function acceptOffscreenPort(port: chrome.runtime.Port, extensionId: string): boolean {
  const ours =
    port.name === OFFSCREEN_PORT && port.sender?.id === extensionId && port.sender.tab == null;
  // This worker serves no other port: anything else is closed.
  if (!ours) port.disconnect();
  return ours;
}
