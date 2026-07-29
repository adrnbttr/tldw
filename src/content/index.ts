import type { ContentMessage, ContentInbound, DetectedVideo } from '@/types';
import {
  dedupe,
  dropRedundantNatives,
  externalIdFromUrl,
  keepFirstOfProvider,
  makeDetected,
  pageVideoFromUrl,
  providerFromUrl,
} from './detect';

/** Strips the provider suffix a watch page adds to document.title. */
function cleanTitle(title: string): string {
  return title
    .replace(/\s*[-–|]\s*YouTube\s*$/i, '')
    .replace(/\s+on Vimeo\s*$/i, '')
    .trim();
}

/**
 * Content script (F1).
 *
 * Scans the page for videos on load and on every DOM mutation, then pushes the
 * de-duplicated list to the background. Cross-origin iframes are never accessed —
 * only their `src` is read to derive the provider and external id (spec §3.1).
 */

/** Direct http(s) media URL of a native video, or null for MSE/blob streams. */
function nativeMediaSrc(video: HTMLVideoElement): string | null {
  const candidate =
    video.currentSrc ||
    video.src ||
    (video.querySelector('source[src]') as HTMLSourceElement | null)?.src ||
    '';
  return candidate.startsWith('http') ? candidate : null;
}

function scan(): DetectedVideo[] {
  const found: DetectedVideo[] = [];

  // The provider's own watch page (youtube.com/watch, youtu.be, vimeo.com/id),
  // where the player is a native <video> rather than an iframe.
  const page = pageVideoFromUrl(location.href);
  if (page) {
    found.push(
      makeDetected({
        provider: page.provider,
        externalId: page.externalId,
        title: cleanTitle(document.title) || null,
      }),
    );
  }

  // Native <video> elements.
  for (const el of document.querySelectorAll('video')) {
    const video = el as HTMLVideoElement;
    found.push(
      makeDetected({
        provider: 'native',
        title: document.title || null,
        duration: Number.isFinite(video.duration) ? video.duration : null,
        mediaSrc: nativeMediaSrc(video),
        isPlaying: !video.paused,
      }),
    );
  }

  // Known embeds via <iframe src>.
  for (const el of document.querySelectorAll('iframe[src]')) {
    const src = (el as HTMLIFrameElement).src;
    const provider = providerFromUrl(src);
    if (provider === 'unknown') continue;
    found.push(
      makeDetected({
        provider,
        externalId: externalIdFromUrl(src, provider),
        title: (el as HTMLIFrameElement).title || document.title || null,
        iframeSrc: src,
      }),
    );
  }

  // Common JS-player containers via data attributes.
  for (const el of document.querySelectorAll('[data-vimeo-id]')) {
    found.push(
      makeDetected({
        provider: 'vimeo',
        externalId: (el as HTMLElement).dataset.vimeoId ?? '',
      }),
    );
  }
  for (const el of document.querySelectorAll('[data-youtube-id]')) {
    found.push(
      makeDetected({
        provider: 'youtube',
        externalId: (el as HTMLElement).dataset.youtubeId ?? '',
      }),
    );
  }

  const videos = dropRedundantNatives(dedupe(found));
  // On a watch page, the page-URL video is authoritative for its provider.
  return page ? keepFirstOfProvider(videos, page.provider) : videos;
}

let lastSignature = '';

function publish(): void {
  const videos = scan();
  const signature = videos.map((v) => `${v.provider}:${v.externalId}`).join('|');
  if (signature === lastSignature) return;
  lastSignature = signature;

  const message: ContentMessage = { type: 'VIDEOS_DETECTED', videos };
  chrome.runtime.sendMessage(message).catch(() => {
    // Background not ready yet — the next mutation will retry.
  });
}

/**
 * Briefly plays the target video (muted) so its media requests fire and the
 * background can capture them — sparing the user from starting playback manually.
 * Best-effort: browser autoplay policies may still require a real user gesture.
 */
function primeMedia(video: DetectedVideo): void {
  try {
    if (video.provider === 'native') {
      const el = document.querySelector('video');
      if (!el) return;
      el.muted = true;
      void el.play().catch(() => {});
      window.setTimeout(() => {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
      }, 4000);
      return;
    }

    const iframes = [...document.querySelectorAll<HTMLIFrameElement>('iframe[src]')];
    const iframe =
      iframes.find((f) => f.src === video.iframeSrc) ||
      (video.externalId ? iframes.find((f) => f.src.includes(video.externalId)) : undefined);
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

/**
 * One-time setup, guarded so the popup can re-inject this file to force a rescan
 * (e.g. on a tab that was already open when the extension loaded, or an SPA that
 * mounted its player without a DOM mutation we caught) without stacking a second
 * observer or message listener. A re-injection just re-scans.
 */
const w = window as typeof window & { __tldwReady?: boolean };

if (w.__tldwReady) {
  // Already set up by a previous injection — force a fresh scan.
  lastSignature = '';
  publish();
} else {
  w.__tldwReady = true;

  chrome.runtime.onMessage.addListener(
    (message: ContentInbound, _sender, sendResponse: (r: { text: string }) => void) => {
      if (message.type === 'PRIME_MEDIA') {
        primeMedia(message.video);
        return false;
      }
      if (message.type === 'FETCH_TEXT') {
        // Same-origin fetch from the page context (correct referer/cookies).
        fetch(message.url, { credentials: 'include' })
          .then((r) => (r.ok ? r.text() : ''))
          .then((text) => sendResponse({ text }))
          .catch(() => sendResponse({ text: '' }));
        return true; // async response
      }
      return false;
    },
  );

  publish();

  let debounce = 0 as unknown as number;
  const observer = new MutationObserver(() => {
    // Debounce bursts of mutations.
    clearTimeout(debounce);
    debounce = setTimeout(publish, 400) as unknown as number;
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
