import type { DetectedVideo, Provider } from '@/types';

/**
 * Pure detection helpers (F1).
 *
 * Kept free of DOM globals where possible so they can be unit-tested. The content
 * script wires these to the live DOM in `index.ts`.
 */

const YOUTUBE_HOSTS = /(?:youtube\.com|youtube-nocookie\.com|youtu\.be)/i;
const VIMEO_HOSTS = /player\.vimeo\.com/i;

export function providerFromUrl(url: string): Provider {
  if (YOUTUBE_HOSTS.test(url)) return 'youtube';
  if (VIMEO_HOSTS.test(url)) return 'vimeo';
  return 'unknown';
}

/** Extracts the host video id from an embed/watch/share URL. */
export function externalIdFromUrl(url: string, provider: Provider): string {
  try {
    const u = new URL(url, 'https://example.invalid');
    if (provider === 'youtube') {
      if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1);
      const embed = u.pathname.match(/\/embed\/([^/?]+)/);
      if (embed) return embed[1];
      return u.searchParams.get('v') ?? '';
    }
    if (provider === 'vimeo') {
      const m = u.pathname.match(/\/video\/(\d+)/);
      if (m) return m[1];
      return u.pathname.replace(/\D/g, '');
    }
  } catch {
    return '';
  }
  return '';
}

export function isKnownEmbed(url: string): boolean {
  const provider = providerFromUrl(url);
  return provider === 'youtube' || provider === 'vimeo';
}

let counter = 0;
function localId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `vid-${Date.now()}-${counter++}`;
}

export function makeDetected(
  partial: Partial<DetectedVideo> & { provider: Provider },
): DetectedVideo {
  return {
    id: localId(),
    provider: partial.provider,
    externalId: partial.externalId ?? '',
    title: partial.title ?? null,
    duration: partial.duration ?? null,
    iframeSrc: partial.iframeSrc ?? null,
    isPlaying: partial.isPlaying ?? false,
  };
}

/** De-duplicates by provider + externalId, keeping the first occurrence. */
export function dedupe(videos: DetectedVideo[]): DetectedVideo[] {
  const seen = new Set<string>();
  const out: DetectedVideo[] = [];
  for (const v of videos) {
    const key = `${v.provider}:${v.externalId || v.iframeSrc || v.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
