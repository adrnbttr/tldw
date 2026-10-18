/**
 * Sender gate for the privileged log requests (`GET_LOGS`, `CLEAR_LOGS`,
 * `GET_DIAGNOSTICS`): only the extension's own pages — popup, options,
 * offscreen — may read or wipe the central log buffer or collect the
 * diagnostics report. The sender must carry our runtime id *and* come from a
 * `chrome-extension://<id>/` document. The tab is not a criterion: the popup
 * opened as a tab has one. A content script runs in a web page, so its
 * `sender.url` is that page's — refused even under our id; another extension
 * messages us with its own `sender.id` — refused too.
 *
 * Pure: the caller passes the runtime id, so the gate stays testable
 * without the chrome API.
 */

/** Minimal sender shape — satisfied by `chrome.runtime.MessageSender`. */
export interface MessageSenderLike {
  id?: string;
  /** URL of the frame that sent the message (the web page, for a content script). */
  url?: string;
  origin?: string;
  tab?: unknown;
}

/** True when the message comes from one of the extension's own pages. */
export function isExtensionPageSender(
  sender: MessageSenderLike | undefined,
  runtimeId: string,
): boolean {
  if (sender == null || !runtimeId || sender.id !== runtimeId) return false;
  const own = `chrome-extension://${runtimeId}`;
  const fromOwnPage = typeof sender.url === 'string' && sender.url.startsWith(`${own}/`);
  const fromOwnOrigin = typeof sender.origin === 'string' && sender.origin === own;
  return fromOwnPage || fromOwnOrigin;
}

/** Minimal sender shape of a content script message (see `chrome.runtime.MessageSender`). */
export interface ContentSenderLike extends MessageSenderLike {
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
}

/**
 * A content script of this extension running in a tab: our runtime id, a tab
 * with an id, and a sender URL that is not one of our own pages (the popup
 * opened in a tab has a tab too). What it may publish is scoped to its own
 * tab and frame by the caller (`sender.tab.id`, `sender.frameId`) — never
 * taken from the message.
 */
export function isContentScriptSender(
  sender: ContentSenderLike | undefined,
  runtimeId: string,
): sender is ContentSenderLike & { tab: { id: number } } {
  if (sender == null || !runtimeId || sender.id !== runtimeId) return false;
  if (sender.tab?.id == null || !Number.isInteger(sender.tab.id)) return false;
  return !isExtensionPageSender(sender, runtimeId);
}

/**
 * The extension's own service worker — the only sender allowed to drive the
 * offscreen document (`OFFSCREEN_TRANSCRIBE`). Our runtime id, no tab, and a
 * `sender.url` that is either absent or the worker script itself
 * (`serviceWorkerUrl`, from the manifest): the popup and other extension pages
 * have their own page URL and are refused.
 */
export function isServiceWorkerSender(
  sender: MessageSenderLike | undefined,
  runtimeId: string,
  serviceWorkerUrl: string | undefined,
): boolean {
  if (sender == null || !runtimeId || sender.id !== runtimeId) return false;
  if (sender.tab != null) return false;
  if (sender.url == null) return true;
  return serviceWorkerUrl != null && sender.url === serviceWorkerUrl;
}
