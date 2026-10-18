import { describeUrl } from '@/shared/safe-url';

/**
 * Host + a coarse path description only: player and media URLs carry signed,
 * expiring tokens in the query *and* in the path (Akamai `~hmac=`, googlevideo
 * `/sig/…`, Drive `/file/d/<id>/`), so neither survives — no signed URL ever
 * reaches the buffer (the logger's redaction is the second net).
 */
export function loggableUrl(raw: string | null): string | null {
  return describeUrl(raw);
}
