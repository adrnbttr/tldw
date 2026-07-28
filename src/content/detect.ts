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

/**
 * Detects the video of a provider's OWN watch page (youtube.com/watch, youtu.be,
 * vimeo.com/{id}) from the page URL — where the player is a native `<video>`, not
 * an iframe. Lets those be summarized via captions instead of the audio fallback.
 */
export function pageVideoFromUrl(url: string): { provider: Provider; externalId: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = u.searchParams.get('v');
    if (id) return { provider: 'youtube', externalId: id };
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    if (id) return { provider: 'youtube', externalId: id };
  }
  if (host === 'vimeo.com') {
    const id = u.pathname.match(/^\/(\d+)/)?.[1];
    if (id) return { provider: 'vimeo', externalId: id };
  }
  return null;
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
    mediaSrc: partial.mediaSrc ?? null,
    isPlaying: partial.isPlaying ?? false,
  };
}

/**
 * When a page has a real YouTube/Vimeo player, native `<video>` elements are
 * almost always pre-roll ads or the player's internal element — not independent
 * content. Drop them so the user only sees the actual video.
 */
export function dropRedundantNatives(videos: DetectedVideo[]): DetectedVideo[] {
  const hasEmbed = videos.some((v) => v.provider === 'youtube' || v.provider === 'vimeo');
  return hasEmbed ? videos.filter((v) => v.provider !== 'native') : videos;
}

/**
 * On a provider's own watch page, the page-URL video is authoritative: keep only
 * the first entry of that provider and drop the rest (other iframes on the page are
 * ads, related videos, or a miniplayer of the same clip).
 */
export function keepFirstOfProvider(videos: DetectedVideo[], provider: Provider): DetectedVideo[] {
  let kept = false;
  return videos.filter((v) => {
    if (v.provider !== provider) return true;
    if (kept) return false;
    kept = true;
    return true;
  });
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
