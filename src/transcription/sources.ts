import type { DetectedVideo } from '@/types';
import type { MediaCandidate } from './media';
import { classifyMedia, isGoogleVideoUrl } from './media';

/**
 * Which media sources the audio fallback may use for one requested video.
 *
 * A tab can hold several players, and captures outlive the player that
 * produced them, so tab-wide captures are narrowed down before the offscreen
 * document ranks them (`pickBestCandidate`):
 *
 *   1. a native `<video>`'s own direct http(s) URL — the exact file, no guess;
 *   2. Vimeo's own config for the requested id;
 *   3. captured requests, with googlevideo-family streams reserved to Drive
 *      (they belong to a Drive/YouTube player, never to a Vimeo/native one),
 *      then scoped to the requested video's frame when that frame issued a
 *      whole-media candidate (not just loose segments — those alone cannot
 *      be transcribed, see transcription/index.ts).
 *
 * `attributed` says whether the chosen sources can be tied to THIS video. When
 * they cannot (several frames captured streams, none of them the video's), the
 * transcript is still produced but its summary must not be cached under the
 * video's id — it might describe another player's stream.
 */
export interface SourceSelection {
  sources: MediaCandidate[];
  attributed: boolean;
}

export function selectSources(
  video: Pick<DetectedVideo, 'provider' | 'mediaSrc' | 'frameId'>,
  captured: MediaCandidate[],
  vimeoConfig: MediaCandidate[] = [],
): SourceSelection {
  // 1. A native <video>'s own file. A <video src> that is not a blob is a
  // directly fetchable file, so an extension-less URL is still progressive.
  if (video.mediaSrc && /^https?:\/\//i.test(video.mediaSrc)) {
    const kind = classifyMedia(video.mediaSrc);
    return {
      sources: [{ url: video.mediaSrc, kind: kind === 'unknown' ? 'progressive' : kind }],
      attributed: true,
    };
  }

  // 2. Vimeo's config, resolved from the requested id.
  if (vimeoConfig.length > 0) return { sources: dedupe(vimeoConfig), attributed: true };

  // 3. Captures.
  let pool: MediaCandidate[];
  if (video.provider === 'drive') {
    const google = captured.filter((c) => isGoogleVideoUrl(c.url));
    pool = google.length > 0 ? google : captured;
  } else {
    pool = captured.filter((c) => !isGoogleVideoUrl(c.url));
  }
  pool = dedupe(pool);
  if (pool.length === 0) return { sources: [], attributed: false };

  if (video.frameId != null) {
    const own = pool.filter((c) => c.frameId === video.frameId);
    if (own.some((c) => c.kind !== 'segment')) return { sources: own, attributed: true };
  }
  const frames = new Set(pool.map((c) => c.frameId ?? -1));
  return { sources: pool, attributed: frames.size === 1 };
}

function dedupe(sources: MediaCandidate[]): MediaCandidate[] {
  const seen = new Set<string>();
  return sources.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}
