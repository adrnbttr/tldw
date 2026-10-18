import type { DetectedVideo, Provider } from '@/types';
import { fnv1a, videoKey } from '@/shared/video-key';

/**
 * Pure detection helpers (F1).
 *
 * Kept free of DOM globals where possible so they can be unit-tested. The content
 * script wires these to the live DOM in `index.ts`.
 *
 * URLs are always parsed (host + path), never matched as whole strings: a share
 * widget whose query string mentions youtube.com, or YouTube's own non-video
 * frames (subscribe button, live chat), must not become a video.
 */

const DRIVE_HOST = 'drive.google.com';
/** Drive's internal player, embedded cross-origin by the Drive preview page. */
const DRIVE_PLAYER_HOST = 'youtube.googleapis.com';
/** Drive file URLs: /file/d/{id} followed by /view, /preview, or nothing. */
const DRIVE_FILE_PATH = /^\/file\/d\/([^/?#]+)(?:\/(?:view|preview))?\/?$/;
/** A host video id: letters, digits, `-` and `_` (YouTube ids are 11 of those). */
const ID = /^[\w-]+$/;
/** `/embed/<x>` values that are not a video id (playlist / channel live embeds). */
const YOUTUBE_PSEUDO_IDS = new Set(['videoseries', 'live_stream']);

interface Parts {
  /** Lower-case host without a leading `www.`. */
  host: string;
  path: string;
  params: URLSearchParams;
  /** origin + path + search, without the fragment. */
  bare: string;
}

/** Parses an absolute http(s) URL, or null. */
function parse(url: string): Parts | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return {
    host: u.hostname.toLowerCase().replace(/^www\./, ''),
    path: u.pathname,
    params: u.searchParams,
    bare: `${u.origin}${u.pathname}${u.search}`,
  };
}

const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const idOrNull = (value: string | null | undefined) => (value && ID.test(value) ? value : null);

function isYoutubeHost(host: string): boolean {
  return isHost(host, 'youtube.com') || isHost(host, 'youtube-nocookie.com');
}

/**
 * The YouTube video id of an embed / watch / shorts / live / youtu.be URL, or
 * null — including for YouTube URLs that are not a single video (playlist
 * `videoseries`, channel `live_stream`, subscribe button, live chat, feeds).
 */
export function youtubeIdFromUrl(url: string): string | null {
  const p = parse(url);
  if (!p) return null;
  if (p.host === 'youtu.be') return idOrNull(p.path.split('/')[1]);
  if (!isYoutubeHost(p.host)) return null;
  const m = p.path.match(/^\/(embed|shorts|live|v|e)\/([^/]+)\/?$/);
  if (m) return YOUTUBE_PSEUDO_IDS.has(m[2]) ? null : idOrNull(m[2]);
  if (p.path === '/watch' || p.path === '/watch/') return idOrNull(p.params.get('v'));
  return null;
}

/** The Vimeo id of a vimeo.com page or player.vimeo.com/video URL, or null. */
export function vimeoIdFromUrl(url: string): string | null {
  const p = parse(url);
  if (!p) return null;
  if (p.host === 'player.vimeo.com') return p.path.match(/^\/video\/(\d+)/)?.[1] ?? null;
  if (p.host !== 'vimeo.com') return null;
  const m =
    p.path.match(/^\/(\d+)(?:\/|$)/) ??
    p.path.match(/^\/channels\/[^/]+\/(\d+)(?:\/|$)/) ??
    p.path.match(/^\/(?:showcase|album)\/[^/]+\/video\/(\d+)(?:\/|$)/) ??
    p.path.match(/^\/groups\/[^/]+\/videos\/(\d+)(?:\/|$)/);
  return m?.[1] ?? null;
}

/**
 * The Drive file id of a drive.google.com/file/d/{id}/(view|preview) URL, or
 * null. The player URL (youtube.googleapis.com/embed/…) carries no file id —
 * only the drive.google.com page/embed does.
 */
function driveIdFrom(url: string): string | null {
  const p = parse(url);
  if (!p || p.host !== DRIVE_HOST) return null;
  return p.path.match(DRIVE_FILE_PATH)?.[1] ?? null;
}

/** Whether this is Drive's internal player (youtube.googleapis.com/embed/…). */
function isDrivePlayer(url: string): boolean {
  const p = parse(url);
  return !!p && p.host === DRIVE_PLAYER_HOST && p.path.startsWith('/embed');
}

/**
 * Provider of an embed/player URL. `youtube` / `vimeo` only when a video id can
 * be read from it (an id-less YouTube frame is a widget, not a video).
 */
export function providerFromUrl(url: string): Provider {
  // Drive's player lives on youtube.googleapis.com — checked before the generic
  // YouTube hosts so it is never mistaken for a regular YouTube embed.
  if (isDrivePlayer(url) || driveIdFrom(url) != null) return 'drive';
  if (youtubeIdFromUrl(url) != null) return 'youtube';
  const p = parse(url);
  if (p?.host === 'player.vimeo.com' && vimeoIdFromUrl(url) != null) return 'vimeo';
  return 'unknown';
}

/** Extracts the host video id from an embed/watch/share URL ('' when none). */
export function externalIdFromUrl(url: string, provider: Provider): string {
  if (provider === 'youtube') return youtubeIdFromUrl(url) ?? '';
  if (provider === 'vimeo') return vimeoIdFromUrl(url) ?? '';
  if (provider === 'drive') return driveIdFrom(url) ?? '';
  return '';
}

/**
 * Detects the video of a provider's OWN watch page (youtube.com/watch|shorts|live
 * on www/m/music, youtu.be, vimeo.com/{id} and its channel/showcase shapes,
 * drive.google.com/file/d/{id}/view) from the page URL — where the player is a
 * native `<video>`, not an iframe. Lets those be summarized via captions instead
 * of the audio fallback. Embed URLs are not watch pages (see {@link selfEmbedFromUrl}).
 */
export function pageVideoFromUrl(url: string): { provider: Provider; externalId: string } | null {
  const p = parse(url);
  if (!p) return null;
  if (p.host === 'youtu.be' || (isYoutubeHost(p.host) && !p.path.startsWith('/embed'))) {
    const id = youtubeIdFromUrl(url);
    if (id) return { provider: 'youtube', externalId: id };
    return null;
  }
  if (p.host === 'vimeo.com') {
    const id = vimeoIdFromUrl(url);
    return id ? { provider: 'vimeo', externalId: id } : null;
  }
  if (p.host === DRIVE_HOST) {
    const id = driveIdFrom(url);
    return id ? { provider: 'drive', externalId: id } : null;
  }
  return null;
}

/**
 * The video a provider's embed frame plays, read from the frame's own URL
 * (youtube.com/embed/{id}, player.vimeo.com/video/{id}). Lets a player frame
 * report itself even when its parent cannot see the `<iframe>` (shadow DOM,
 * closed roots); de-duplicated with the parent's entry by the worker.
 */
export function selfEmbedFromUrl(url: string): { provider: Provider; externalId: string } | null {
  const provider = providerFromUrl(url);
  if (provider !== 'youtube' && provider !== 'vimeo') return null;
  const externalId = externalIdFromUrl(url, provider);
  return externalId ? { provider, externalId } : null;
}

/**
 * Whether the frame at `url` belongs to a provider whose videos are listed by
 * URL (YouTube, Vimeo, Drive and Drive's player). Its native `<video>` elements
 * are that player's internals (or its pre-roll ads), never independent content.
 */
export function isProviderFrameUrl(url: string): boolean {
  const p = parse(url);
  if (!p) return false;
  return (
    isYoutubeHost(p.host) ||
    p.host === 'youtu.be' ||
    p.host === DRIVE_PLAYER_HOST ||
    p.host === DRIVE_HOST ||
    isHost(p.host, 'vimeo.com')
  );
}

/**
 * Hosted players whose `<iframe>` is listed before (or without) a `<video>`
 * inside it — click-to-build players, posters. Each yields `family:id`.
 */
const EMBED_HOSTS: Array<{
  family: string;
  match: (p: Parts) => boolean;
  id: (p: Parts) => string | null;
}> = [
  {
    family: 'wistia',
    match: (p) =>
      isHost(p.host, 'wistia.net') || isHost(p.host, 'wistia.com') || p.host === 'wi.st',
    id: (p) => p.path.match(/^\/(?:embed\/iframe|embed\/medias|medias)\/([a-z0-9]+)/i)?.[1] ?? null,
  },
  {
    family: 'loom',
    match: (p) => isHost(p.host, 'loom.com'),
    id: (p) => p.path.match(/^\/(?:embed|share)\/([a-f0-9]+)/i)?.[1] ?? null,
  },
  {
    family: 'dailymotion',
    match: (p) => isHost(p.host, 'dailymotion.com') || p.host === 'dai.ly',
    id: (p) =>
      idOrNull(p.params.get('video')) ??
      p.path.match(/^\/(?:embed\/)?video\/([a-z0-9]+)/i)?.[1] ??
      (p.host === 'dai.ly' ? idOrNull(p.path.split('/')[1]) : null),
  },
  {
    family: 'brightcove',
    match: (p) => p.host === 'players.brightcove.net',
    id: (p) => {
      const account = p.path.split('/')[1];
      const id = idOrNull(p.params.get('videoId'));
      return account && id ? `${account}/${id}` : null;
    },
  },
  {
    family: 'jwplayer',
    match: (p) => isHost(p.host, 'jwplayer.com') || isHost(p.host, 'jwplatform.com'),
    id: (p) =>
      p.path.match(/^\/(?:players|previews)\/([a-z0-9]{8})(?:-[a-z0-9]+)?(?:\.html)?/i)?.[1] ??
      null,
  },
  {
    family: 'kaltura',
    match: (p) => isHost(p.host, 'kaltura.com'),
    id: (p) =>
      idOrNull(p.params.get('entry_id')) ?? p.path.match(/\/entry_id\/([\w-]+)/)?.[1] ?? null,
  },
  {
    family: 'panopto',
    match: (p) => /(^|\.)panopto\.(com|eu)$/.test(p.host),
    id: (p) => idOrNull(p.params.get('id')),
  },
  {
    family: 'streamable',
    match: (p) => p.host === 'streamable.com',
    id: (p) => p.path.match(/^\/(?:e\/|o\/)?([a-z0-9]+)\/?$/i)?.[1] ?? null,
  },
  {
    family: 'twitch',
    match: (p) => p.host === 'player.twitch.tv' || p.host === 'clips.twitch.tv',
    id: (p) => {
      const video = idOrNull(p.params.get('video')?.replace(/^v/, ''));
      if (video) return `v${video}`;
      const clip = idOrNull(p.params.get('clip'));
      if (clip) return `clip:${clip}`;
      const channel = idOrNull(p.params.get('channel'));
      return channel ? `channel:${channel.toLowerCase()}` : null;
    },
  },
];

/**
 * Identity of a known hosted-player URL (Wistia, Loom, Dailymotion, Brightcove,
 * JW Player, Kaltura, Panopto, Streamable, Twitch): `family:id`, or — when the
 * host is known but the id is not readable — `family:#hash` of the URL (both the
 * parent's `<iframe src>` and the frame's own `location` hash to the same key).
 * `requireId` refuses that fallback. Null for any other URL.
 */
export function knownEmbedKey(url: string, { requireId = false } = {}): string | null {
  const p = parse(url);
  if (!p) return null;
  for (const host of EMBED_HOSTS) {
    if (!host.match(p)) continue;
    const id = host.id(p);
    if (id) return `${host.family}:${id}`;
    return requireId ? null : `${host.family}:#${fnv1a(p.bare)}`;
  }
  return null;
}

/** YouTube id of a thumbnail URL (i.ytimg.com/vi/{id}/…, img.youtube.com/vi/{id}/…). */
export function youtubeIdFromThumbnail(url: string): string | null {
  const m = url.match(
    /(?:\/\/|\.)(?:i\d?\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/([\w-]+)\//,
  );
  return m ? m[1] : null;
}

/** Wistia media id of a `wistia_async_{id}` JS-embed container class. */
export function wistiaIdFromClass(className: string): string | null {
  return className.match(/(?:^|\s)wistia_async_([a-z0-9]+)(?:\s|$)/i)?.[1] ?? null;
}

/** What a click-to-load facade or JS-player placeholder stands for. */
export interface FacadeVideo {
  provider: Provider;
  externalId: string;
}

/**
 * Reads a facade / placeholder element (lite-youtube, lite-vimeo, data-youtube-id,
 * data-vimeo-id, Plyr progressive-enhancement markup, data-video-id with a
 * YouTube thumbnail, Wistia JS embed). `attr` reads an attribute; `thumbnail` is
 * the URL of a thumbnail inside the element (img src / background-image), if any.
 * Wistia JS embeds come back as `native` with a `wistia:{id}` identity — the
 * player script builds a plain `<video>` in place.
 */
export function facadeVideo(
  localName: string,
  attr: (name: string) => string | null,
  thumbnail: string | null = null,
): FacadeVideo | null {
  const id = (v: string | null) => idOrNull(v?.trim());
  if (localName === 'lite-youtube') {
    const v = id(attr('videoid'));
    return v ? { provider: 'youtube', externalId: v } : null;
  }
  if (localName === 'lite-vimeo') {
    const v = id(attr('videoid'));
    return v ? { provider: 'vimeo', externalId: v } : null;
  }
  const yt = id(attr('data-youtube-id'));
  if (yt) return { provider: 'youtube', externalId: yt };
  const vimeo = id(attr('data-vimeo-id'));
  if (vimeo) return { provider: 'vimeo', externalId: vimeo };

  const plyrProvider = attr('data-plyr-provider');
  const plyrId = attr('data-plyr-embed-id')?.trim();
  if (plyrId && (plyrProvider === 'youtube' || plyrProvider === 'vimeo')) {
    const fromUrl = plyrProvider === 'youtube' ? youtubeIdFromUrl(plyrId) : vimeoIdFromUrl(plyrId);
    const v = fromUrl ?? id(plyrId);
    return v ? { provider: plyrProvider, externalId: v } : null;
  }

  const wistia = wistiaIdFromClass(attr('class') ?? '');
  if (wistia) return { provider: 'native', externalId: `wistia:${wistia}` };

  // Generic `data-video-id`: only a YouTube facade when a YouTube thumbnail
  // backs it (the attribute alone is used by Brightcove, JW Player, CMSes…).
  const dataId = id(attr('data-video-id'));
  const thumbId = thumbnail ? youtubeIdFromThumbnail(thumbnail) : null;
  if (dataId && thumbId) return { provider: 'youtube', externalId: thumbId };
  return null;
}

/** Thumbnail URL inside a CSS `background-image: url(...)` declaration, if any. */
export function backgroundImageUrl(style: string | null): string | null {
  return style?.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/)?.[1] ?? null;
}

/**
 * A fresh unique local id. `crypto.randomUUID` only exists in secure contexts:
 * on an http page the fallback must still be unique across the tab's frames
 * (several content scripts start in the same millisecond with the same
 * counter), so it is random too — `getRandomValues` works in any context.
 */
export function localId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `vid-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function makeDetected(
  partial: Partial<DetectedVideo> & { provider: Provider },
): DetectedVideo {
  return {
    id: partial.id ?? localId(),
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

/**
 * De-duplicates by video identity (shared/video-key.ts — host id, else media /
 * embed URL, else local id), keeping the first occurrence: two `<video>` playing
 * the same file are one video.
 */
export function dedupe(videos: DetectedVideo[]): DetectedVideo[] {
  const seen = new Set<string>();
  const out: DetectedVideo[] = [];
  for (const v of videos) {
    const key = videoKey(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Whether a `<video>` box is worth listing: invisible (0×0, from `display:none`)
 * and tiny ones are trackers or UI decoration. `strict` raises the bar to an
 * ad-slot size (200×112) — used in about:blank / srcdoc / data: frames, where ad
 * networks render their video creatives.
 */
export function isMeaningfulVideoBox(width: number, height: number, strict = false): boolean {
  return strict ? width >= 200 && height >= 112 : width >= 120 && height >= 68;
}

/**
 * A background / hero loop: muted, looping, autoplaying and without controls.
 * Listed only when it is the frame's single video and covers at least half of
 * the viewport (see {@link keepDecorative}).
 */
export function isDecorativeVideo(v: {
  muted: boolean;
  loop: boolean;
  autoplay: boolean;
  controls: boolean;
}): boolean {
  return v.muted && v.loop && v.autoplay && !v.controls;
}

/** Whether a decorative loop covers enough of the viewport to be the page's video. */
export function keepDecorative(
  box: { width: number; height: number },
  viewport: { width: number; height: number },
): boolean {
  const area = viewport.width * viewport.height;
  return area > 0 && (box.width * box.height) / area >= 0.5;
}
