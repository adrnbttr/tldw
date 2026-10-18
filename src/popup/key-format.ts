/**
 * API key field helpers (onboarding + settings). Format checks only — the key
 * is never sent anywhere to be validated.
 */

const OPENROUTER_PREFIX = 'sk-or-';

/**
 * Normalizes a pasted key: API keys never contain whitespace, so line breaks,
 * spaces and surrounding quotes picked up by a sloppy copy are dropped.
 */
export function cleanKey(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '');
}

/**
 * True when `key` is empty, a prefix of "sk-or-" being typed, or starts with
 * it — i.e. when there is nothing to warn about.
 */
export function looksLikeOpenRouterKey(key: string): boolean {
  const k = key.trim();
  return k === '' || OPENROUTER_PREFIX.startsWith(k) || k.startsWith(OPENROUTER_PREFIX);
}
