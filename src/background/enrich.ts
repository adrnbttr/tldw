import type { DetectedVideo } from '@/types';

/**
 * Metadata enrichment for embedded videos.
 *
 * Cross-origin iframes hide their duration/title from the content script, so the
 * list shows neither. We fill them in from the providers' public oEmbed endpoints
 * (CORS-friendly, no key). Vimeo oEmbed returns the duration; YouTube's returns
 * only the title. Results are cached by provider+id to avoid refetching.
 */

interface Meta {
  duration: number | null;
  title: string | null;
}

const cache = new Map<string, Meta>();
const FETCH_TIMEOUT_MS = 4000;

function key(video: DetectedVideo): string {
  return `${video.provider}:${video.externalId}`;
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMeta(video: DetectedVideo): Promise<Meta> {
  if (video.provider === 'vimeo') {
    const data = await fetchJson(
      `https://vimeo.com/api/oembed.json?url=https://vimeo.com/${video.externalId}`,
    );
    return {
      duration: typeof data?.duration === 'number' ? data.duration : null,
      title: typeof data?.title === 'string' ? data.title : null,
    };
  }
  if (video.provider === 'youtube') {
    const data = await fetchJson(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${video.externalId}&format=json`,
    );
    return { duration: null, title: typeof data?.title === 'string' ? data.title : null };
  }
  return { duration: null, title: null };
}

async function metaFor(video: DetectedVideo): Promise<Meta> {
  const k = key(video);
  const cached = cache.get(k);
  if (cached) return cached;
  const meta = await fetchMeta(video);
  cache.set(k, meta);
  return meta;
}

/** Returns the videos with duration/title filled in where they were missing. */
export async function enrichVideos(videos: DetectedVideo[]): Promise<DetectedVideo[]> {
  return Promise.all(
    videos.map(async (video) => {
      const needsMeta =
        (video.provider === 'vimeo' || video.provider === 'youtube') &&
        !!video.externalId &&
        (video.duration == null || video.title == null);
      if (!needsMeta) return video;

      const meta = await metaFor(video);
      return {
        ...video,
        duration: video.duration ?? meta.duration,
        title: video.title ?? meta.title,
      };
    }),
  );
}
