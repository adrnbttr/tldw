/**
 * A video located on the current page by the content script (F1).
 *
 * The content script never accesses the *contents* of a cross-origin iframe — it
 * only reads the iframe `src` to derive the provider and external id.
 */
export type Provider = 'youtube' | 'vimeo' | 'native' | 'unknown';

export interface DetectedVideo {
  /** Stable id generated locally for this detection (crypto.randomUUID). */
  id: string;
  provider: Provider;
  /** The id used by the host (YouTube video id, Vimeo id...). Empty when unknown. */
  externalId: string;
  /** Human-readable title if the page exposes one. */
  title: string | null;
  /** Duration in seconds if known. */
  duration: number | null;
  /** Full iframe/player URL, when the video is embedded. */
  iframeSrc: string | null;
  isPlaying: boolean;
}
