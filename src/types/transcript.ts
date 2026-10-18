import type { Provider } from './video';

/**
 * The normalized `Transcript` object (F6).
 *
 * This is THE contract between every extraction path and the summarizer. Whether
 * the text comes from YouTube captions, Vimeo captions or an audio transcription,
 * the summarizer only ever sees this shape — which is what guarantees an identical
 * output formalism regardless of the path taken (spec §2.1).
 */
export type TranscriptSource =
  'youtube_captions' | 'vimeo_captions' | 'audio_transcription' | 'youtube_video';

export interface TranscriptSegment {
  /** Segment start, in seconds. */
  start: number;
  /** Segment end, in seconds. */
  end: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  source: TranscriptSource;
  /** BCP-47 language tag, e.g. "fr". */
  language: string;
  duration: number;
  segments: TranscriptSegment[];
  /** All segment text concatenated, ready for the LLM. */
  fullText: string;
  metadata: {
    title: string | null;
    provider: Provider;
    /** ISO-8601 timestamp of extraction. */
    extractedAt: string;
    /**
     * `false` when the audio came from tab-wide captures that could not be tied
     * to this video (several players captured, none in its frame): the summary
     * is shown but never cached under the video's id. Absent = attributed.
     */
    sourceAttributed?: boolean;
    /**
     * `true` when the transcribed media covers clearly less than the video's
     * expected duration (e.g. only a few captured segments): the summary is
     * shown but never cached. Absent = complete as far as we can tell.
     */
    partial?: boolean;
  };
}

/** Builds `fullText` from segments with single-space joining and trimming. */
export function buildFullText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
