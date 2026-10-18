import type { DetectedVideo } from '@/types';
import { videoKey } from '@/shared/video-key';

/**
 * Merges the lists published by each frame of a tab into the one list the popup
 * shows (F1). The top frame (id 0) comes first and wins ties; every video is
 * stamped with the frame that reported it, so frame-bound actions can target it.
 *
 * De-duplicated across frames on the shared video identity (shared/video-key.ts):
 * an embed seen by the parent (iframe `src`) and by the frame itself (page URL)
 * collapses to one; natives collapse by media URL. A hosted-player placeholder
 * (a parent's Wistia/Loom/… `<iframe>`, see {@link isEmbedPlaceholder}) is
 * replaced in place by the player frame's own `<video>` entry of the same
 * identity — that one has the media URL, the duration, and the frame to prime.
 *
 * Natives are never dropped tab-wide: the page's own `<video>` next to a YouTube
 * embed is content. A YouTube/Vimeo/Drive player's internal `<video>` is
 * filtered by the content script running inside that player's frame.
 *
 * Identity of a native `<video>`: only the identity a frame derives from its
 * OWN URL (`frameKeys`, the `knownEmbedKey(location.href)` its content script
 * sends) is trusted. Any other host id on a native entry comes from DOM hints
 * (a `wistia_async_<id>` container, `data-mwtitle`) that any page — an ad
 * frame included — can forge: it is dropped here ({@link withTrustedIdentity}),
 * so such a video can neither replace another frame's placeholder nor share
 * (and poison) the cache / job key of the real video. Its identity falls back
 * to its media URL.
 */
export function mergeFrameVideos(
  frames: Map<number, DetectedVideo[]>,
  frameKeys: ReadonlyMap<number, string | null | undefined> = new Map(),
): DetectedVideo[] {
  const ids = [...frames.keys()].sort((a, b) => a - b);
  const at = new Map<string, number>();
  const merged: DetectedVideo[] = [];
  for (const frameId of ids) {
    for (const published of frames.get(frameId) ?? []) {
      const video = withTrustedIdentity(published, frameKeys.get(frameId));
      const key = videoKey(video);
      const index = at.get(key);
      if (index == null) {
        at.set(key, merged.length);
        merged.push({ ...video, frameId });
        continue;
      }
      const kept = merged[index];
      if (isEmbedPlaceholder(kept) && !isEmbedPlaceholder(video)) {
        merged[index] = { ...video, title: video.title ?? kept.title, frameId };
      }
    }
  }
  return merged;
}

/**
 * A native `<video>` keeps its host id only when it is the identity of its own
 * frame's URL; a DOM-hint identity is dropped (see {@link mergeFrameVideos}).
 * Placeholders (identity read from an `<iframe src>`, i.e. the URL of the frame
 * that really plays it) and hosted providers (YouTube/Vimeo/Drive, whose id is
 * what gets summarized) are left as they are.
 */
export function withTrustedIdentity(
  video: DetectedVideo,
  frameKey: string | null | undefined,
): DetectedVideo {
  if (video.provider !== 'native' || video.iframeSrc != null || !video.externalId) return video;
  if (frameKey && video.externalId === frameKey) return video;
  return { ...video, externalId: '' };
}

/**
 * A parent frame's entry for a known hosted player's `<iframe>` (native, listed
 * from its `src`), as opposed to the `<video>` reported from inside the player.
 */
export function isEmbedPlaceholder(video: DetectedVideo): boolean {
  return video.provider === 'native' && video.iframeSrc != null;
}

/**
 * Records the list a frame just published. An empty list removes the frame's
 * entry instead of storing `[]`: a frame that lost its player (iframe emptied or
 * reloaded) must not leave its previous videos behind in the merged list.
 */
export function setFrameVideos(
  frames: Map<number, DetectedVideo[]>,
  frameId: number,
  videos: DetectedVideo[],
): void {
  if (videos.length === 0) frames.delete(frameId);
  else frames.set(frameId, videos);
}
