import type { DetectedVideo, Provider, Transcript } from '@/types';

/**
 * Adapter contract (spec §2.2).
 *
 * Every adapter takes a `DetectedVideo` and returns a normalized `Transcript`, or
 * throws a `TldwError`. `NO_CAPTIONS_AVAILABLE` is the signal that the orchestrator
 * should drop to the audio fallback (level 2).
 */
export interface Adapter {
  provider: Provider;
  /** Whether this adapter can, in principle, handle the given video. */
  canHandle(video: DetectedVideo): boolean;
  /** Level 1 extraction: captions/text tracks. */
  extractCaptions(video: DetectedVideo, signal?: AbortSignal): Promise<Transcript>;
}
