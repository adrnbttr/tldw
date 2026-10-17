/**
 * Sender gate for the privileged log requests (`GET_LOGS`, `CLEAR_LOGS`,
 * `GET_DIAGNOSTICS`): only the extension's own pages — popup, options,
 * offscreen — may read or wipe the central log buffer or collect the
 * diagnostics report. Those pages run on the extension origin, so their
 * sender carries our runtime id and no tab. A content script always has a
 * `sender.tab` (it runs inside a web page, even on our id), and another
 * extension messages us with its own `sender.id` — both are refused.
 *
 * Pure: the caller passes the runtime id, so the gate stays testable
 * without the chrome API.
 */

/** Minimal sender shape — satisfied by `chrome.runtime.MessageSender`. */
export interface MessageSenderLike {
  id?: string;
  /** Set whenever the message comes from inside a web page (content script). */
  tab?: unknown;
}

/** True when the message comes from one of the extension's own pages. */
export function isExtensionPageSender(
  sender: MessageSenderLike | undefined,
  runtimeId: string,
): boolean {
  return sender != null && sender.id === runtimeId && sender.tab == null;
}
