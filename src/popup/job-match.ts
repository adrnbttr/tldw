import type { DetectedVideo, JobState } from '@/types';
import { videoKey } from '@/shared/video-key';

/**
 * Maps the worker's jobs onto the videos the popup lists (F2).
 *
 * Jobs are keyed by the local id of the video they were started for, but a
 * re-scan (or the popup reopening after the content script republished) gives
 * the same video a fresh local id. The stable video key bridges the two, so a
 * running, queued or INTERRUPTED job still shows on its video. A running job
 * wins over a terminal one; then the video's own id; then any keyed match.
 */
export function matchJobs(
  videos: DetectedVideo[],
  jobsById: Record<string, JobState>,
  keysById: Record<string, string>,
): Record<string, JobState> {
  const byKey = new Map<string, JobState[]>();
  for (const [jobId, key] of Object.entries(keysById)) {
    const state = jobsById[jobId];
    if (!state) continue;
    const list = byKey.get(key) ?? [];
    list.push(state);
    byKey.set(key, list);
  }

  const out: Record<string, JobState> = {};
  for (const video of videos) {
    const candidates = [
      ...(jobsById[video.id] ? [jobsById[video.id]] : []),
      ...(byKey.get(videoKey(video)) ?? []),
    ];
    const pick = candidates.find((s) => s.phase === 'running') ?? candidates[0];
    if (pick) out[video.id] = pick;
  }
  return out;
}
