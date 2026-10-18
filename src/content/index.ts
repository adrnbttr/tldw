import type { ContentMessage, ContentInbound, DetectedVideo } from '@/types';
import {
  backgroundImageUrl,
  dedupe,
  externalIdFromUrl,
  facadeVideo,
  isDecorativeVideo,
  isMeaningfulVideoBox,
  isProviderFrameUrl,
  keepDecorative,
  keepFirstOfProvider,
  knownEmbedKey,
  localId,
  makeDetected,
  pageVideoFromUrl,
  providerFromUrl,
  selfEmbedFromUrl,
  youtubeIdFromThumbnail,
} from './detect';
import {
  FACADE_SELECTOR,
  INTERESTING_SELECTOR,
  OBSERVED_ATTRIBUTES,
  THUMBNAIL_SELECTOR,
  collectShadowRoots,
  createScheduler,
  summarizeMutations,
} from './observe';
import { createClientLogger } from '@/shared/logger-client';
import { fnv1a, stableVideoKey, videoKey } from '@/shared/video-key';

/** Content logger — ships to the worker's buffer; no echo, the page's console stays untouched. */
const log = createClientLogger('content');

/** Strips the provider suffix a watch page adds to document.title. */
function cleanTitle(title: string): string {
  return title
    .replace(/\s*[-–|]\s*YouTube\s*$/i, '')
    .replace(/\s+on Vimeo\s*$/i, '')
    .replace(/\s*[-–|]\s*Google Drive\s*$/i, '')
    .trim();
}

/**
 * Content script (F1).
 *
 * Scans the page for videos on load and on every relevant DOM mutation, then
 * pushes the de-duplicated list to the background. Cross-origin iframes are
 * never accessed from the outside — only their `src` is read to derive the
 * provider and external id (spec §3.1). The manifest injects this script into
 * every frame, so the `<video>` inside a cross-origin player frame is reported
 * by that frame itself and can be driven for media capture (Drive, generic
 * embeds); the worker merges the frames' lists (background/frame-videos.ts).
 *
 * What is listed, per frame:
 * - the provider's own watch page / embed frame, from the URL;
 * - native `<video>` elements (light DOM and open shadow roots) whose box is
 *   meaningful — tiny or hidden ones are watched and listed once revealed;
 *   background loops only when they are the frame's single, large video;
 *   natives inside a YouTube/Vimeo/Drive frame are that player's internals;
 * - YouTube/Vimeo/Drive `<iframe>`s (also lazy `data-src` ones) and known
 *   hosted players (Wistia, Loom, Dailymotion…) before their `<video>` exists;
 * - click-to-load facades (lite-youtube, data-youtube-id, YouTube thumbnails…).
 */

/** True in an iframe. FETCH_TEXT stays top-frame only (page origin, exactly once). */
const isSubframe = window.self !== window.top;

/** Direct http(s) media URL of a native video, or null for MSE/blob streams. */
function nativeMediaSrc(video: HTMLVideoElement): string | null {
  const candidate = rawMediaSrc(video);
  return candidate.startsWith('http') ? candidate : null;
}

function rawMediaSrc(video: HTMLVideoElement): string {
  return (
    video.currentSrc ||
    video.src ||
    (video.querySelector('source[src]') as HTMLSourceElement | null)?.src ||
    ''
  );
}

// ---------------------------------------------------------------------------
// Stable identity
// ---------------------------------------------------------------------------

/**
 * One local id per element for the document's lifetime: a re-scan (or a
 * REPORT_VIDEOS) gives the same element the same `DetectedVideo.id`, so the
 * popup row, the running job and PRIME_MEDIA all keep pointing at it. When the
 * element's identity changes (new src, new watch-page id) the id changes too —
 * a job started for the previous video must not attach to the new one.
 */
const uids = new WeakMap<object, string>();

function uidOf(el: object): string {
  let uid = uids.get(el);
  if (!uid) {
    uid = localId();
    uids.set(el, uid);
  }
  return uid;
}

/** Gives `video` the stable id of `el`. */
function withStableId(video: DetectedVideo, el: object): DetectedVideo {
  const key = stableVideoKey(video);
  video.id = key ? `${uidOf(el)}~${fnv1a(key)}` : uidOf(el);
  return video;
}

// ---------------------------------------------------------------------------
// Shadow DOM
// ---------------------------------------------------------------------------

/** Min delay between two shadow-DOM discovery walks (each looks at every element). */
const SHADOW_WALK_INTERVAL_MS = 3000;
/**
 * Re-walks while custom elements are still undefined: their shadow root
 * appears when the player bundle defines (upgrades) them, which no DOM
 * mutation reveals — and `customElements` is not reachable from the isolated
 * world. Bounded: a handful of retries per document.
 */
const UPGRADE_RETRY_MS = [1500, 3000, 6000, 12000, 24000];

const knownRoots = new Set<ShadowRoot>();
let lastWalk = -Infinity;
let walkTimer: ReturnType<typeof setTimeout> | null = null;
let walkAt = 0;
let upgradeRetries = 0;
/** Whether the last scan wanted shadow discovery (no meaningful light-DOM video). */
let wantsWalk = false;

/** Discovers new open shadow roots; true when some were found. */
function walkShadow(): boolean {
  lastWalk = Date.now();
  const res = collectShadowRoots(document);
  let added = false;
  for (const root of res.roots as ShadowRoot[]) {
    if (knownRoots.has(root)) continue;
    knownRoots.add(root);
    observeRoot(root);
    added = true;
  }
  if (upgradeRetries < UPGRADE_RETRY_MS.length && document.querySelector(':not(:defined)')) {
    requestWalk(UPGRADE_RETRY_MS[upgradeRetries++]);
  }
  return added;
}

/** Schedules a (throttled, trailing) discovery walk; publishes if it finds roots. */
function requestWalk(delayMs = 0): void {
  if (dead) return;
  const now = Date.now();
  const at = Math.max(now + delayMs, lastWalk + SHADOW_WALK_INTERVAL_MS);
  if (walkTimer != null) {
    if (walkAt <= at) return;
    clearTimeout(walkTimer);
  }
  walkAt = at;
  walkTimer = setTimeout(() => {
    walkTimer = null;
    if (dead) return;
    if (walkShadow()) schedulePublish();
  }, at - now);
}

function observeRoot(root: ShadowRoot): void {
  observer.observe(root, OBSERVE_OPTIONS);
  // Media events do not bubble out of a shadow root: listen inside it too.
  for (const type of MEDIA_EVENTS) root.addEventListener(type, schedulePublish, true);
}

/** `<video>` / `<iframe>` elements inside the known (still attached) shadow roots. */
function shadowElements(): { videos: HTMLVideoElement[]; iframes: HTMLIFrameElement[] } {
  const videos: HTMLVideoElement[] = [];
  const iframes: HTMLIFrameElement[] = [];
  for (const root of knownRoots) {
    if (!root.host.isConnected) {
      knownRoots.delete(root);
      continue;
    }
    videos.push(...root.querySelectorAll('video'));
    iframes.push(...root.querySelectorAll('iframe'));
  }
  return { videos, iframes };
}

// ---------------------------------------------------------------------------
// Sizes (and videos revealed later)
// ---------------------------------------------------------------------------

interface Size {
  width: number;
  height: number;
}

/**
 * Box sizes of the measured elements, kept current by a ResizeObserver. An
 * element is measured synchronously once (getBoundingClientRect forces a
 * layout — costly on a page that mutates nonstop), then only read from here.
 * A size change re-scans the frame: a video skipped while hidden (tab,
 * accordion, modal, not laid out yet) is listed once revealed, and one that
 * shrinks to nothing is dropped.
 */
const sizes = new WeakMap<Element, Size>();
const sizeObserver =
  typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const border = entry.borderBoxSize?.[0];
          const size = border
            ? { width: border.inlineSize, height: border.blockSize }
            : { width: entry.contentRect.width, height: entry.contentRect.height };
          const previous = sizes.get(entry.target);
          if (previous?.width !== size.width || previous?.height !== size.height) changed = true;
          sizes.set(entry.target, size);
        }
        if (changed) schedulePublish();
      })
    : null;

function boxOf(el: Element): Size {
  const known = sizes.get(el);
  if (known && sizeObserver) return known;
  const rect = el.getBoundingClientRect();
  const size = { width: rect.width, height: rect.height };
  sizes.set(el, size);
  sizeObserver?.observe(el);
  return size;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/** about:blank / srcdoc / data: frames: where ad networks render video creatives. */
function isAdHostingFrame(): boolean {
  if (!isSubframe) return false;
  if (location.protocol === 'about:' || location.protocol === 'data:') return true;
  // A document.write()n about:blank frame takes its creator's URL: recognise it
  // from the parent side (same-origin only — `frameElement` is null otherwise).
  try {
    const host = window.frameElement;
    if (!host) return false;
    const src = host.getAttribute('src');
    return !src || src === 'about:blank' || host.hasAttribute('srcdoc');
  } catch {
    return false;
  }
}

/** `src` of an iframe, or its lazy-loading `data-src` / `data-lazy-src` before it loads. */
function iframeUrl(frame: HTMLIFrameElement): string {
  const src = frame.getAttribute('src') ? frame.src : '';
  if (/^https?:/i.test(src)) return src;
  const lazy = frame.getAttribute('data-src') || frame.getAttribute('data-lazy-src');
  if (lazy) {
    try {
      return new URL(lazy, document.baseURI).href;
    } catch {
      /* unparseable — ignore */
    }
  }
  return src;
}

/** Identity a facade container gives to the `<video>` its player script builds in place. */
function containerIdentity(video: HTMLVideoElement): string {
  const container = video.closest('[class*="wistia_async_"]');
  if (!container) return '';
  const facade = facadeVideo(container.localName, (n) => container.getAttribute(n));
  return facade?.provider === 'native' ? facade.externalId : '';
}

function nativeEntry(video: HTMLVideoElement): DetectedVideo {
  // MediaWiki TimedMediaHandler placeholders: no src until clicked, but a file
  // name and a duration hint (the main player and its thumbnail are one file).
  const mwTitle = video.getAttribute('data-mwtitle');
  const hint = Number(video.getAttribute('data-durationhint'));
  const duration =
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : hint > 0 ? hint : null;
  return withStableId(
    makeDetected({
      provider: 'native',
      externalId: mwTitle ? `mw:${mwTitle}` : containerIdentity(video),
      title: document.title || null,
      duration,
      mediaSrc: nativeMediaSrc(video),
      isPlaying: !video.paused,
    }),
    video,
  );
}

function iframeEntry(frame: HTMLIFrameElement): DetectedVideo | null {
  const url = iframeUrl(frame);
  if (!url) return null;
  const title = frame.title || document.title || null;
  const provider = providerFromUrl(url);
  if (provider !== 'unknown') {
    return withStableId(
      makeDetected({
        provider,
        externalId: externalIdFromUrl(url, provider),
        title,
        iframeSrc: url,
      }),
      frame,
    );
  }
  // A known hosted player: listed from its URL, even before (or without) the
  // `<video>` inside it — the frame's own native entry replaces this one in
  // the worker's merge (same identity), see background/frame-videos.ts.
  const key = knownEmbedKey(url);
  if (!key) return null;
  return withStableId(
    makeDetected({ provider: 'native', externalId: key, title, iframeSrc: url }),
    frame,
  );
}

/** A YouTube thumbnail inside / behind a facade element. */
function thumbnailOf(el: Element): string | null {
  const img = el.querySelector<HTMLImageElement>(THUMBNAIL_SELECTOR);
  return img?.src || backgroundImageUrl(el.getAttribute('style'));
}

function facadeEntry(el: Element): DetectedVideo | null {
  const facade = facadeVideo(el.localName, (n) => el.getAttribute(n), thumbnailOf(el));
  if (!facade) return null;
  const title =
    el.getAttribute('title') ||
    el.getAttribute('playlabel') ||
    el.getAttribute('aria-label') ||
    document.title ||
    null;
  return withStableId(makeDetected({ ...facade, title }), el);
}

const CLICKABLE_HINT = /play|video|youtube|\byt|facade|embed|player|lyte/i;

/**
 * A YouTube thumbnail used as a hand-made click-to-load facade: not a link card
 * (an `<a href>` to youtube.com is a related-video list), big enough, and inside
 * a container that looks like a player (role/tabindex/onclick, a button, or a
 * player-ish class / id).
 */
function thumbnailFacadeEntry(img: HTMLImageElement): DetectedVideo | null {
  const id = youtubeIdFromThumbnail(img.src);
  if (!id || img.closest('a[href]')) return null;
  let el: Element | null = img;
  let container: Element | null = null;
  for (let depth = 0; el && depth < 3; depth++, el = el.parentElement) {
    if (
      el.getAttribute('role') === 'button' ||
      el.hasAttribute('onclick') ||
      el.hasAttribute('tabindex') ||
      CLICKABLE_HINT.test(`${el.getAttribute('class') ?? ''} ${el.id}`) ||
      (el !== img && el.querySelector('button'))
    ) {
      container = el;
      break;
    }
  }
  if (!container) return null;
  const box = boxOf(container === img ? img : container);
  if (!isMeaningfulVideoBox(box.width, box.height, true)) return null;
  return withStableId(
    makeDetected({ provider: 'youtube', externalId: id, title: img.alt || document.title || null }),
    container,
  );
}

/**
 * The identity this frame derives from its own URL — `knownEmbedKey` of
 * `location.href` (a hosted player's frame: Wistia, Loom…), null elsewhere.
 * Sent with every publish (`frameKey`): the worker lets only this identity
 * replace a parent's placeholder; DOM hints (`wistia_async_<id>` containers,
 * `data-mwtitle`) are forgeable by any page and never trusted for that. An
 * about:blank / srcdoc / data: frame has no URL of its own (it may inherit its
 * creator's), hence no identity.
 */
function ownEmbedKey(): string | null {
  if (isProviderFrameUrl(location.href) || isAdHostingFrame()) return null;
  return knownEmbedKey(location.href, { requireId: !isSubframe });
}

function scan(): DetectedVideo[] {
  const href = location.href;
  const page = pageVideoFromUrl(href);
  const self = page ? null : selfEmbedFromUrl(href);
  // Inside a YouTube/Vimeo/Drive frame, <video> elements are the player's own.
  const providerFrame = isProviderFrameUrl(href);
  const strict = isAdHostingFrame();

  const hasInteresting = document.querySelector(INTERESTING_SELECTOR) !== null;
  const lightVideos: HTMLVideoElement[] = hasInteresting
    ? [...document.querySelectorAll('video')]
    : [];
  const meaningful = (v: HTMLVideoElement) => {
    const box = boxOf(v);
    return isMeaningfulVideoBox(box.width, box.height, strict);
  };

  // Shadow DOM: discover new roots when the light DOM holds no meaningful video
  // (synchronously when allowed, else trailing); known roots are always read.
  wantsWalk = !page && !providerFrame && !lightVideos.some(meaningful);
  if (wantsWalk) {
    if (Date.now() - lastWalk >= SHADOW_WALK_INTERVAL_MS) walkShadow();
    else requestWalk();
  }
  const shadow = knownRoots.size ? shadowElements() : { videos: [], iframes: [] };
  if (!page && !self && !hasInteresting && shadow.videos.length + shadow.iframes.length === 0) {
    return [];
  }

  const found: DetectedVideo[] = [];
  const root = document.documentElement;
  // The provider's own watch page (youtube.com/watch, youtu.be, vimeo.com/id),
  // where the player is a native <video> rather than an iframe — or its embed
  // frame, which reports itself (the parent may not see the <iframe>).
  const fromUrl = page ?? self;
  if (fromUrl) {
    found.push(
      withStableId(makeDetected({ ...fromUrl, title: cleanTitle(document.title) || null }), root),
    );
  }

  // Native <video> elements.
  const decorative: Array<{ video: HTMLVideoElement; box: Size }> = [];
  if (!providerFrame) {
    const frameKey = ownEmbedKey();
    let keyed = false;
    for (const video of [...lightVideos, ...shadow.videos]) {
      const box = boxOf(video);
      if (!isMeaningfulVideoBox(box.width, box.height, strict)) continue;
      // Inline data: media is an ad creative or a UI animation.
      if (rawMediaSrc(video).startsWith('data:')) continue;
      if (isDecorativeVideo(video)) {
        decorative.push({ video, box });
        continue;
      }
      const entry = nativeEntry(video);
      // A hosted player's frame (Wistia, Loom…): its main video takes the
      // frame's identity, the one its parent lists the <iframe> under.
      if (frameKey && !keyed && !entry.externalId) {
        entry.externalId = frameKey;
        withStableId(entry, video);
        keyed = true;
      }
      found.push(entry);
    }
  }

  // Known embeds via <iframe src> (or lazy data-src).
  for (const frame of [...document.querySelectorAll('iframe'), ...shadow.iframes]) {
    const entry = iframeEntry(frame);
    if (entry) found.push(entry);
  }

  // Click-to-load facades and JS-player placeholders.
  if (hasInteresting) {
    for (const el of document.querySelectorAll(FACADE_SELECTOR)) {
      const entry = facadeEntry(el);
      if (entry) found.push(entry);
    }
    for (const img of document.querySelectorAll<HTMLImageElement>(THUMBNAIL_SELECTOR)) {
      const entry = thumbnailFacadeEntry(img);
      if (entry) found.push(entry);
    }
  }

  // A background loop is only the page's video when it is alone and large.
  if (found.length === 0 && decorative.length === 1) {
    const { video, box } = decorative[0];
    if (keepDecorative(box, { width: window.innerWidth, height: window.innerHeight })) {
      found.push(nativeEntry(video));
    }
  }

  const videos = dedupe(found);
  // On a watch page, the page-URL video is authoritative for its provider.
  return page ? keepFirstOfProvider(videos, page.provider) : videos;
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

let lastSignature = '';
let lastHref = location.href;
/** Set once the extension context is gone (extension reloaded/updated). */
let dead = false;

/**
 * Sends to the worker. After an extension reload this orphaned script's
 * `chrome.runtime` throws synchronously ("Extension context invalidated"):
 * the script then shuts itself down instead of throwing on every mutation.
 */
function send(message: ContentMessage): void {
  try {
    if (!chrome.runtime?.id) throw new Error('Extension context invalidated');
    chrome.runtime.sendMessage(message).catch(() => {
      // Background not ready yet — the next change (or REPORT_VIDEOS) will retry.
    });
  } catch {
    shutdown();
  }
}

/**
 * Scans and sends the list when it changed — or, `force` (REPORT_VIDEOS), when
 * it is not empty even though unchanged: the worker asked for it.
 */
function publish(force = false): void {
  if (dead) return;
  lastHref = location.href;
  const videos = scan();
  // mediaSrc, duration and title are part of it: a <video> detected before
  // `loadedmetadata`, or an SPA whose title follows the route, must be
  // republished once they are known.
  const signature = videos
    .map(
      (v) =>
        `${v.id}:${videoKey(v)}:${v.mediaSrc ?? ''}:${Math.round(v.duration ?? -1)}:${v.title ?? ''}`,
    )
    .join('|');
  // An empty list has the empty signature: a frame that never found anything
  // stays silent, while one that previously published videos (non-empty
  // signature) does publish the empty list, so the worker drops its entry
  // (and the frame's captures). Unloading is covered by `pagehide` below.
  const changed = signature !== lastSignature;
  if (!changed && !(force && signature !== '')) return;
  lastSignature = signature;

  // Changed result only — a mutation burst, or the worker's report requests
  // (one per SPA route change), must not spam the log buffer: each line is a
  // LOG message to the worker and a rewrite of the persisted buffer.
  if (changed) {
    log.info('videos detected', {
      count: videos.length,
      providers: [...new Set(videos.map((v) => v.provider))],
    });
  }
  send({ type: 'VIDEOS_DETECTED', videos, frameKey: videos.length ? ownEmbedKey() : null });
}

// ---------------------------------------------------------------------------
// PRIME_MEDIA
// ---------------------------------------------------------------------------

/** How long a primed video plays before it is paused again (the worker waits 5 s). */
const PRIME_HOLD_MS = 4500;

/** Every `<video>` of the frame, light DOM and known shadow roots, unfiltered. */
function allVideos(): HTMLVideoElement[] {
  return [...document.querySelectorAll('video'), ...shadowElements().videos];
}

/** The frame's main video: the largest one on screen, else the first. */
function mainVideo(): HTMLVideoElement | null {
  const videos = allVideos();
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of videos) {
    const box = v.getBoundingClientRect();
    const area = box.width * box.height;
    if (area > bestArea) {
      best = v;
      bestArea = area;
    }
  }
  return best ?? videos[0] ?? null;
}

/** The element a native DetectedVideo was built from (stable id), if in this frame. */
function videoFor(video: DetectedVideo): HTMLVideoElement | null {
  const uid = video.id.split('~')[0];
  const videos = allVideos();
  return (
    videos.find((v) => uids.get(v) === uid) ??
    (video.mediaSrc ? videos.find((v) => nativeMediaSrc(v) === video.mediaSrc) : undefined) ??
    null
  );
}

/**
 * Briefly plays `el` (muted) so its media requests fire and the worker can
 * capture them. A video already playing is left alone — the user is watching
 * it and its requests are flowing. Otherwise the muted state, position and
 * pause are restored afterwards, unless the user took over meanwhile (unmuted).
 */
function primeElement(el: HTMLVideoElement): void {
  if (!el.paused) return;
  const wasMuted = el.muted;
  const position = el.currentTime;
  el.muted = true;
  void el.play().catch(() => {});
  window.setTimeout(() => {
    try {
      if (!el.muted) return; // the user unmuted it: theirs now
      el.pause();
      if (Number.isFinite(position) && position > 0) el.currentTime = position;
      el.muted = wasMuted;
    } catch {
      /* ignore */
    }
  }, PRIME_HOLD_MS);
}

/**
 * Briefly plays the target video (muted) so its media requests fire and the
 * background can capture them — sparing the user from starting playback manually.
 * Best-effort: browser autoplay policies may still require a real user gesture.
 */
function primeMedia(video: DetectedVideo): void {
  try {
    if (video.provider === 'native') {
      // The worker targets the frame that reported the video (frameId); a
      // hosted-player placeholder (iframeSrc) is broadcast and primed by the
      // player frame whose own URL has that identity.
      let el = videoFor(video);
      if (!el && video.iframeSrc && video.externalId) {
        if (knownEmbedKey(location.href) === video.externalId) el = mainVideo();
      } else if (!el && !video.iframeSrc && (video.frameId != null || !isSubframe)) {
        el = mainVideo();
      }
      if (el) primeElement(el);
      return;
    }

    if (video.provider === 'drive') {
      // Drive's player is cross-origin from the host page: the manifest injects
      // this script into Drive's own frames, and PRIME_MEDIA is broadcast to
      // every frame of the tab — so whichever frame hosts the `<video>` (the
      // drive.google.com preview frame or the nested youtube.googleapis.com
      // player) drives it. Elsewhere the player stays out of reach and this is
      // a harmless no-op.
      if (providerFromUrl(location.href) === 'drive') {
        const el = mainVideo();
        if (el) primeElement(el);
      }
      return;
    }

    const iframes = [...document.querySelectorAll('iframe'), ...shadowElements().iframes];
    const iframe =
      iframes.find((f) => iframeUrl(f) === video.iframeSrc) ||
      (video.externalId ? iframes.find((f) => iframeUrl(f).includes(video.externalId)) : undefined);
    const win = iframe?.contentWindow;
    if (!win) return;

    if (video.provider === 'vimeo') {
      win.postMessage(
        JSON.stringify({ method: 'setVolume', value: 0 }),
        'https://player.vimeo.com',
      );
      win.postMessage(JSON.stringify({ method: 'play' }), 'https://player.vimeo.com');
      window.setTimeout(
        () => win.postMessage(JSON.stringify({ method: 'pause' }), 'https://player.vimeo.com'),
        4000,
      );
    } else if (video.provider === 'youtube') {
      // Only works when the embed has enablejsapi=1; harmless otherwise.
      win.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*');
      win.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
      window.setTimeout(
        () =>
          win.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*'),
        4000,
      );
    }
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * One-time setup. The script body runs once per document (the crxjs loader
 * imports a cached ES module), so a rescan is requested with REPORT_VIDEOS
 * rather than by re-injecting.
 */
function onMessage(
  message: ContentInbound,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (r: { text: string }) => void,
): boolean {
  if (dead) return false;
  if (message.type === 'REPORT_VIDEOS') {
    // Worker restarted, tab navigated, or popup rescan: the worker lost (or
    // must confirm) our list, so publish even though nothing changed.
    publish(true);
    return false;
  }
  if (message.type === 'PRIME_MEDIA') {
    primeMedia(message.video);
    return false;
  }
  if (message.type === 'FETCH_TEXT' && !isSubframe) {
    // Same-origin fetch from the page context (correct referer/cookies).
    // Top frame only: the page's origin — so exactly one fetch happens even
    // though this script also runs inside Drive's iframes, and a sub-frame
    // (drive.google.com origin) never races its own response in.
    fetch(message.url, { credentials: 'include' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => sendResponse({ text }))
      .catch(() => sendResponse({ text: '' }));
    return true; // async response
  }
  return false;
}

/** Trailing debounce with a 2 s max-wait: a page mutating nonstop still publishes. */
const schedulePublish = createScheduler(
  () => {
    if (!dead) publish();
  },
  400,
  2000,
);

const MEDIA_EVENTS = ['loadedmetadata', 'durationchange', 'play'] as const;
const OBSERVE_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: OBSERVED_ATTRIBUTES,
};

/** A discovery walk is already due no later than a fresh request would set it. */
function walkPending(): boolean {
  if (walkTimer == null) return false;
  // Same test as requestWalk's early return, reading the clock only when needed.
  return walkAt <= lastWalk + SHADOW_WALK_INTERVAL_MS || walkAt <= Date.now();
}

const observer = new MutationObserver((records) => {
  // One pass over the records for both questions (see summarizeMutations).
  // A custom element (or shadow host) appeared: its root is invisible to this
  // observer, so look for it — only while the frame has no light-DOM video,
  // and not when a walk is already on its way.
  const { relevant, shadowCandidate } = summarizeMutations(records, wantsWalk && !walkPending());
  if (shadowCandidate) requestWalk();
  // Cheap filter first; an SPA route change (pushState) moves no node we care
  // about but still changes the watch-page video, hence the href check.
  if (!relevant && location.href === lastHref) return;
  schedulePublish();
});

/** SPA route changes (pushState / replaceState / hash) without any DOM change. */
function onUrlChange(): void {
  if (location.href !== lastHref) schedulePublish();
}

/** A sub-frame/page going away retracts its list (the worker drops the frame). */
function onPageHide(): void {
  if (lastSignature === '') return;
  lastSignature = '';
  send({ type: 'VIDEOS_DETECTED', videos: [] });
}

/** Restored from the back/forward cache: publish again. */
function onPageShow(event: PageTransitionEvent): void {
  if (event.persisted) publish();
}

const navigationApi = (window as unknown as { navigation?: EventTarget }).navigation;

function shutdown(): void {
  if (dead) return;
  dead = true;
  observer.disconnect();
  sizeObserver?.disconnect();
  if (walkTimer != null) clearTimeout(walkTimer);
  for (const type of MEDIA_EVENTS) window.removeEventListener(type, schedulePublish, true);
  for (const root of knownRoots) {
    for (const type of MEDIA_EVENTS) root.removeEventListener(type, schedulePublish, true);
  }
  navigationApi?.removeEventListener('currententrychange', onUrlChange);
  window.removeEventListener('popstate', onUrlChange);
  window.removeEventListener('hashchange', onUrlChange);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
  try {
    chrome.runtime.onMessage.removeListener(onMessage);
  } catch {
    /* context already gone */
  }
}

chrome.runtime.onMessage.addListener(onMessage);
publish();
if (!dead) {
  observer.observe(document.documentElement, OBSERVE_OPTIONS);
  // Media events do not bubble: capture them at the window. They fire when a
  // <video> learns its source/duration or starts playing.
  for (const type of MEDIA_EVENTS) window.addEventListener(type, schedulePublish, true);
  navigationApi?.addEventListener('currententrychange', onUrlChange);
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);
  // A frame being reloaded or navigated away never gets to publish its new
  // (empty) state from this document, and the fresh script that replaces it
  // stays silent when it finds nothing: retract our list on the way out.
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
}
