import type { MediaCandidate, MediaKind } from '@/transcription/media';
import { classifyMedia, isMediaUrl, normalizeMediaUrl } from '@/transcription/media';
import { log } from './log';
import { loggableUrl } from './loggable-url';

/**
 * Media segment capture (F5.1).
 *
 * Observes network requests on each tab and records candidate media URLs so the
 * audio fallback can find the stream. Purely observational — nothing is blocked.
 *
 * Manifests (master.json / HLS / DASH) are kept in a separate, non-evicting set:
 * they are requested once, up front, and must not be pushed out of the buffer by
 * the flood of media segments that follows.
 *
 * Captures are scoped so a stale stream never stands in for the requested
 * video: each one remembers the frame that issued it (webRequest `frameId`),
 * a tab's captures are dropped when its top-level URL changes (full or SPA
 * navigation — `tabs.onUpdated` `changeInfo.url`, no extra permission; a
 * hash-only change is not a navigation and keeps them), and a frame's captures
 * are dropped when that frame retracts its videos (empty `VIDEOS_DETECTED`,
 * e.g. on `pagehide` — see background/index.ts).
 *
 * Persistence: MV3 kills idle workers, and a manifest is requested once, when
 * playback starts — lose it and only loose segments remain. Captures are
 * therefore mirrored (debounced) to `chrome.storage.session`, restored on
 * worker start (`capturesReady`). That area is RAM-only, cleared with the
 * browser session, and — this extension never calls `setAccessLevel` — not
 * readable by content scripts, so the (signed) URLs stay inside the extension.
 */

const MAX_SEGMENTS_PER_TAB = 60;
/** Manifests do not churn like segments, but a long SPA session must stay bounded. */
const MAX_MANIFESTS_PER_TAB = 30;
/** Tabs mirrored to session storage (most recently touched first). */
const MAX_PERSISTED_TABS = 40;
const STORAGE_KEY = 'tldw:mediaCaptures';
const PERSIST_DELAY_MS = 500;
const MANIFEST_KINDS = new Set<MediaKind>(['vimeo_master', 'hls', 'dash']);

interface TabCapture {
  manifests: MediaCandidate[];
  segments: MediaCandidate[];
  /** Top-level URL (hash stripped) the captures belong to, when known. */
  url?: string;
  /** Last change (ms), to keep the most recent tabs when persisting. */
  touched: number;
}

const captured = new Map<number, TabCapture>();

let persistTimer: ReturnType<typeof setTimeout> | undefined;

/** Session-storage mirror, or null outside the extension (tests, other contexts). */
function sessionArea(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.session ? chrome.storage.session : null;
}

/** Debounced mirror of the captures to session storage — best effort. */
function schedulePersist(): void {
  if (!sessionArea() || persistTimer !== undefined) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    const area = sessionArea();
    if (!area) return;
    const tabs = [...captured.entries()]
      .sort((a, b) => b[1].touched - a[1].touched)
      .slice(0, MAX_PERSISTED_TABS);
    const value: Record<string, TabCapture> = {};
    for (const [tabId, entry] of tabs) value[String(tabId)] = entry;
    area.set({ [STORAGE_KEY]: value }).catch(() => {
      // Quota or transient failure — memory stays authoritative.
    });
  }, PERSIST_DELAY_MS);
}

function isCandidate(c: unknown): c is MediaCandidate {
  return (
    typeof c === 'object' &&
    c !== null &&
    typeof (c as MediaCandidate).url === 'string' &&
    typeof (c as MediaCandidate).kind === 'string'
  );
}

let ready: Promise<void> = Promise.resolve();

/**
 * Resolves once the captures persisted by a previous worker are merged back
 * into memory. Readers that may run right after a worker restart (the audio
 * fallback) await it before `getCapturedMedia`.
 */
export function capturesReady(): Promise<void> {
  return ready;
}

async function restoreCaptures(): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  try {
    const stored = (await area.get(STORAGE_KEY))[STORAGE_KEY] as
      Record<string, Partial<TabCapture>> | undefined;
    if (!stored || typeof stored !== 'object') return;
    for (const [key, saved] of Object.entries(stored)) {
      const tabId = Number(key);
      if (!Number.isInteger(tabId) || tabId < 0 || !saved) continue;
      const live = captured.get(tabId);
      // Something already happened on this tab since the restart: keep the
      // live picture, unless it is the same page (then merge what was lost).
      if (live?.url !== undefined && saved.url !== live.url) continue;
      const entry = live ?? { manifests: [], segments: [], touched: Date.now() };
      entry.url ??= typeof saved.url === 'string' ? saved.url : undefined;
      for (const bucket of ['manifests', 'segments'] as const) {
        const restored = (Array.isArray(saved[bucket]) ? saved[bucket] : []).filter(isCandidate);
        const known = new Set(entry[bucket].map((c) => c.url));
        entry[bucket] = [...restored.filter((c) => !known.has(c.url)), ...entry[bucket]];
      }
      entry.segments = entry.segments.slice(-MAX_SEGMENTS_PER_TAB);
      entry.manifests = entry.manifests.slice(-MAX_MANIFESTS_PER_TAB);
      captured.set(tabId, entry);
    }
  } catch {
    // Unreadable store — start empty.
  }
}

/** URL without its fragment: a hash change is not a navigation. */
function withoutHash(url: string): string {
  const at = url.indexOf('#');
  return at === -1 ? url : url.slice(0, at);
}

/**
 * At most one debug line per tab + host: `record` runs inside the webRequest
 * listener — a hot loop — so a segment flood must not flood the buffer too.
 * Hosts already logged for a tab stay silent afterwards.
 */
const loggedHosts = new Map<number, Set<string>>();

/** Guarded, de-duplicated debug trail of what capture accepts (never a signed URL). */
function logCapture(tabId: number, url: string, kind: MediaKind): void {
  const printable = loggableUrl(url);
  if (!printable) return;
  // Manifests name the stream and only appear a few times per tab — always
  // worth one line each.
  if (MANIFEST_KINDS.has(kind)) {
    log.debug('media captured', { tabId, kind, url: printable });
    return;
  }
  const host = printable.split('/')[0];
  const seen = loggedHosts.get(tabId) ?? new Set<string>();
  if (seen.has(host)) return;
  seen.add(host);
  loggedHosts.set(tabId, seen);
  log.debug('media captured', { tabId, kind, url: printable });
}

function record(tabId: number, rawUrl: string, frameId?: number): void {
  if (tabId < 0) return;
  // Strip byte-range params (googlevideo chunks) so all requests for the same
  // file land on one "whole file" URL and de-duplicate against each other.
  const url = normalizeMediaUrl(rawUrl);
  if (!isMediaUrl(url)) return;
  const kind = classifyMedia(url);
  const entry = captured.get(tabId) ?? { manifests: [], segments: [], touched: 0 };
  const bucket = MANIFEST_KINDS.has(kind) ? entry.manifests : entry.segments;
  if (bucket.some((c) => c.url === url)) return;
  bucket.push(frameId != null && frameId >= 0 ? { url, kind, frameId } : { url, kind });
  const cap = bucket === entry.segments ? MAX_SEGMENTS_PER_TAB : MAX_MANIFESTS_PER_TAB;
  if (bucket.length > cap) bucket.shift();
  entry.touched = Date.now();
  captured.set(tabId, entry);
  schedulePersist();
  logCapture(tabId, url, kind);
}

export function getCapturedMedia(tabId: number): MediaCandidate[] {
  const entry = captured.get(tabId);
  const media = entry ? [...entry.manifests, ...entry.segments] : [];
  const hosts = [
    ...new Set(
      media
        .map((m) => loggableUrl(m.url)?.split('/')[0])
        .filter((host): host is string => host != null),
    ),
  ];
  log.debug('captured media for tab', { tabId, count: media.length, hosts });
  return media;
}

export function clearCapturedMedia(tabId: number): void {
  if (captured.delete(tabId)) schedulePersist();
  loggedHosts.delete(tabId);
}

/**
 * Top-level URL change of a tab: a real navigation (anything but the hash
 * differs, or the previous URL is unknown) drops the tab's captures; the new
 * URL is remembered either way.
 */
function onTabUrl(tabId: number, rawUrl: string): void {
  const url = withoutHash(rawUrl);
  const entry = captured.get(tabId);
  if (entry?.url === url) return;
  clearCapturedMedia(tabId);
  captured.set(tabId, { manifests: [], segments: [], url, touched: Date.now() });
  schedulePersist();
}

/** Drops the captures one frame issued (that frame lost its player / is unloading). */
export function clearFrameCaptures(tabId: number, frameId: number): void {
  const entry = captured.get(tabId);
  if (!entry) return;
  entry.manifests = entry.manifests.filter((c) => c.frameId !== frameId);
  entry.segments = entry.segments.filter((c) => c.frameId !== frameId);
  schedulePersist();
}

/**
 * URL patterns worth observing — exactly the shapes `classifyMedia` can
 * accept (see transcription/media.ts), so the listener only fires — and only
 * wakes the worker — for plausible media requests instead of every XHR in the
 * browser. Match-pattern paths include the query string, hence the trailing
 * `*`. Keep in sync with `classifyMedia`.
 *
 * Match-pattern paths are case-sensitive while `classifyMedia` is not, so the
 * extensions are listed in lower AND upper case (`.MP4`, `.M3U8`…). Mixed case
 * (`.Mp4`) is not covered — one pattern per casing would be needed, and such
 * URLs are vanishingly rare in practice.
 */
export const MEDIA_URL_PATTERNS = [
  // HLS / DASH / Vimeo manifests (master.json, playlist.json, *.mpd)
  '*://*/*.m3u8*',
  '*://*/*.M3U8*',
  '*://*/*.mpd*',
  '*://*/*.MPD*',
  '*://*/*master.json*',
  '*://*/*playlist.json*',
  // Progressive files and segments
  '*://*/*.mp4*',
  '*://*/*.MP4*',
  // `.ts` / `.m4s` as the path's extension only (with or without a query):
  // `*.ts*` would also wake the worker for `.tsv`, `.tsx`…
  '*://*/*.m4s',
  '*://*/*.m4s?*',
  '*://*/*.M4S',
  '*://*/*.M4S?*',
  '*://*/*.ts',
  '*://*/*.ts?*',
  '*://*/*.TS',
  '*://*/*.TS?*',
  // `segment-N` / `segment_N` (classifyMedia wants a number right after).
  '*://*/*segment-*',
  '*://*/*segment_*',
  // Vimeo CDN audio/video segments (extension-less)
  '*://*.vimeocdn.com/*',
  // Drive / YouTube byte-range streams (extension-less /videoplayback)
  '*://*.googlevideo.com/*',
  '*://*.c.drive.google.com/*',
  '*://*.c.docs.google.com/*',
];

/**
 * Registers the webRequest listener. Safe to call once at startup.
 *
 * Registered at startup (not only while a job runs): users play the video
 * before opening the popup, and those early requests are the captures the
 * audio fallback needs. The filter is narrowed to media-looking URLs instead
 * (`MEDIA_URL_PATTERNS`), which keeps Drive's stream hosts, Vimeo and HLS/DASH
 * covered; `fetch()` media requests arrive as `xmlhttprequest`.
 */
export function installMediaCapture(): void {
  ready = restoreCaptures();
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId >= 0) record(details.tabId, details.url, details.frameId);
    },
    { urls: MEDIA_URL_PATTERNS, types: ['media', 'xmlhttprequest', 'object'] },
  );

  chrome.tabs.onRemoved.addListener((tabId) => clearCapturedMedia(tabId));
  // Top-level URL change (navigation or SPA pushState): every capture of the
  // previous page is stale — but not on a hash-only change. `status:
  // 'loading'` alone is not used — it can also accompany sub-frame loads,
  // which would wipe a live player's captures.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url !== undefined) onTabUrl(tabId, changeInfo.url);
  });
}
