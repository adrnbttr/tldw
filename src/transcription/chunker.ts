import type { TranscriptSegment } from '@/types';

/**
 * Audio chunk planning and transcript reassembly (F5.4, F5.5).
 *
 * Transcription services cap request size (25 MB for OpenAI Whisper). We split the
 * audio into time ranges with a few seconds of overlap so no sentence is cut at a
 * boundary, then de-duplicate the overlapping region when reassembling.
 */

export interface ChunkPlan {
  index: number;
  /** Start offset in seconds. */
  start: number;
  /** End offset in seconds. */
  end: number;
}

export interface ChunkOptions {
  /** Total audio duration in seconds. */
  durationSeconds: number;
  /** Estimated bytes per second of the extracted audio. */
  bytesPerSecond: number;
  /** Max bytes per request (default 24 MB, under the 25 MB Whisper limit). */
  maxBytes?: number;
  /** Overlap between consecutive chunks, in seconds (default 5). */
  overlapSeconds?: number;
}

/** Plans chunk time-ranges that each stay under the size limit, with overlap. */
export function planChunks(options: ChunkOptions): ChunkPlan[] {
  const {
    durationSeconds,
    bytesPerSecond,
    maxBytes = 24 * 1024 * 1024,
    overlapSeconds = 5,
  } = options;

  if (durationSeconds <= 0 || bytesPerSecond <= 0) return [];

  const maxChunkSeconds = Math.max(overlapSeconds + 1, Math.floor(maxBytes / bytesPerSecond));

  // Single chunk fits.
  if (durationSeconds <= maxChunkSeconds) {
    return [{ index: 0, start: 0, end: durationSeconds }];
  }

  const plans: ChunkPlan[] = [];
  let start = 0;
  let index = 0;
  while (start < durationSeconds) {
    const end = Math.min(start + maxChunkSeconds, durationSeconds);
    plans.push({ index, start, end });
    if (end >= durationSeconds) break;
    start = end - overlapSeconds;
    index++;
  }
  return plans;
}

/**
 * Reassembles per-chunk segment lists into one ordered, de-duplicated list.
 *
 * Each chunk's segment timings are chunk-relative; `offsets[i]` shifts them back
 * to absolute time. Segments whose absolute start falls before the last kept
 * segment's end (minus a small tolerance) are dropped as overlap duplicates.
 */
export function mergeChunkTranscripts(
  chunkSegments: TranscriptSegment[][],
  offsets: number[],
  toleranceSeconds = 1,
): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];
  let lastEnd = -Infinity;

  chunkSegments.forEach((segments, i) => {
    const offset = offsets[i] ?? 0;
    for (const seg of segments) {
      const absStart = seg.start + offset;
      const absEnd = seg.end + offset;
      // Skip if it starts within an already-covered region (overlap duplicate).
      if (absStart < lastEnd - toleranceSeconds) continue;
      merged.push({ start: absStart, end: absEnd, text: seg.text });
      lastEnd = Math.max(lastEnd, absEnd);
    }
  });

  return merged;
}
