import type { ContentMessage, DetectedVideo } from '@/types';
import { dedupe, externalIdFromUrl, makeDetected, providerFromUrl } from './detect';

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

  return dedupe(found);
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

publish();

const observer = new MutationObserver(() => {
  // Debounce bursts of mutations.
  clearTimeout(debounce);
  debounce = setTimeout(publish, 400) as unknown as number;
});
let debounce = 0 as unknown as number;

observer.observe(document.documentElement, { childList: true, subtree: true });
