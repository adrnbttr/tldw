import type {
  ActiveJob,
  BatchState,
  DetailLevel,
  DetectedVideo,
  JobState,
  Request,
  Response,
} from '@/types';

/** Typed wrappers around chrome.runtime messaging for the popup. */

async function send(request: Request): Promise<Response> {
  return (await chrome.runtime.sendMessage(request)) as Response;
}

export async function listVideos(): Promise<DetectedVideo[]> {
  const res = await send({ type: 'LIST_VIDEOS' });
  return res.ok && 'videos' in res ? res.videos : [];
}

/** Forces a fresh detection pass on the active tab and returns the result. */
export async function rescanVideos(): Promise<DetectedVideo[]> {
  const res = await send({ type: 'RESCAN' });
  return res.ok && 'videos' in res ? res.videos : [];
}

export async function getJobState(videoId: string): Promise<JobState> {
  const res = await send({ type: 'GET_JOB_STATE', videoId });
  return res.ok && 'state' in res ? res.state : { phase: 'idle' };
}

export async function getActiveJob(): Promise<ActiveJob | null> {
  const res = await send({ type: 'GET_ACTIVE_JOB' });
  return res.ok && 'active' in res ? res.active : null;
}

export async function requestSummary(video: DetectedVideo): Promise<void> {
  await send({ type: 'SUMMARIZE', video });
}

export async function requestRegenerate(videoId: string, detailLevel: DetailLevel): Promise<void> {
  await send({ type: 'REGENERATE', videoId, detailLevel });
}

export async function cancel(videoId: string): Promise<void> {
  await send({ type: 'CANCEL', videoId });
}

export async function requestBatch(videos: DetectedVideo[]): Promise<void> {
  await send({ type: 'SUMMARIZE_BATCH', videos });
}

export async function getBatchState(): Promise<BatchState> {
  const res = await send({ type: 'GET_BATCH_STATE' });
  return res.ok && 'batch' in res ? res.batch : { phase: 'idle' };
}
