import type { DetectedVideo, JobState, Request, Response } from '@/types';

/** Typed wrappers around chrome.runtime messaging for the popup. */

async function send(request: Request): Promise<Response> {
  return (await chrome.runtime.sendMessage(request)) as Response;
}

export async function listVideos(): Promise<DetectedVideo[]> {
  const res = await send({ type: 'LIST_VIDEOS' });
  return res.ok && 'videos' in res ? res.videos : [];
}

export async function getJobState(videoId: string): Promise<JobState> {
  const res = await send({ type: 'GET_JOB_STATE', videoId });
  return res.ok && 'state' in res ? res.state : { phase: 'idle' };
}

export async function requestSummary(video: DetectedVideo): Promise<void> {
  await send({ type: 'SUMMARIZE', video });
}

export async function cancel(videoId: string): Promise<void> {
  await send({ type: 'CANCEL', videoId });
}
