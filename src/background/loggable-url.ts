/**
 * Host + path only: player and media URLs carry signed, expiring query
 * parameters, so the whole query is dropped before logging — no signed URL
 * ever reaches the buffer (the logger's redaction is the second net).
 */
export function loggableUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const { host, pathname } = new URL(raw);
    return `${host}${pathname}`;
  } catch {
    return null;
  }
}
