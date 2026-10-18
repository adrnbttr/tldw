import type { DetectedVideo, Provider, Transcript } from '@/types';
import type { Locale } from '@/i18n/types';

/**
 * Adapter contract (spec §2.2).
 *
 * Every adapter takes a `DetectedVideo` and returns a normalized `Transcript`, or
 * throws a `TldwError`. `NO_CAPTIONS_AVAILABLE` is the signal that the orchestrator
 * should drop to the audio fallback (level 2).
 */
/** Extra context for caption extraction. */
export interface ExtractOptions {
  /** Summary output language — used as a track-language preference. */
  outputLanguage?: Locale;
  /**
   * Tab the job was requested from: page-context fetches (YouTube timedtext)
   * go through it, never through whatever tab is active later.
   */
  tabId?: number;
}

export interface Adapter {
  provider: Provider;
  /** Whether this adapter can, in principle, handle the given video. */
  canHandle(video: DetectedVideo): boolean;
  /** Level 1 extraction: captions/text tracks. */
  extractCaptions(
    video: DetectedVideo,
    signal?: AbortSignal,
    options?: ExtractOptions,
  ): Promise<Transcript>;
}
