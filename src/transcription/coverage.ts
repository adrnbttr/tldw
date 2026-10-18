/**
 * Media duration vs the video's expected duration (offscreen pipeline, F5).
 *
 * The page's duration (`<video>.duration`, player metadata) and the
 * container's (ffmpeg probe of what was actually downloaded) can disagree:
 * the page may under-report, and the download may hold only part of the
 * stream (a few loose segments). These pure helpers decide how far to plan
 * the transcription and whether the result is too short to be trusted.
 */

/**
 * Duration assumed when neither the page nor the container reports one; the
 * window loop then stops at the first empty window past the real end.
 */
export const UNKNOWN_DURATION_SECONDS = 6 * 3600;

/** A usable duration in seconds, or null (missing, 0, negative, NaN, ∞). */
function validSeconds(seconds: number | null | undefined): number | null {
  return seconds != null && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Duration the chunk/window plan covers: the longer of the page's and the
 * container's (ffmpeg probe) — a page that under-reports must not cut the
 * transcript short, and the loop stops at the first empty window past the
 * real end anyway. Neither known → `UNKNOWN_DURATION_SECONDS`.
 */
export function planningDuration(page: number | null, probed: number | null): number {
  const known = [validSeconds(page), validSeconds(probed)].filter((d): d is number => d != null);
  return known.length > 0 ? Math.max(...known) : UNKNOWN_DURATION_SECONDS;
}

/** Below this share of the expected duration, the media is considered partial. */
export const MIN_COVERAGE = 0.8;

/**
 * True when the downloaded media is clearly shorter than the video the page
 * shows (e.g. a few loose segments of a 1 h stream). Unknown on either side →
 * false: nothing to compare.
 */
export function isPartialMedia(probed: number | null, expected: number | null): boolean {
  const media = validSeconds(probed);
  const page = validSeconds(expected);
  return media != null && page != null && media < MIN_COVERAGE * page;
}
