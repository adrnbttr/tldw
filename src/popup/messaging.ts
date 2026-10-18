import type { DetectedVideo, JobState, KeyedJob, Request, Response } from '@/types';

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

/** Every job of the session with its stable video key (running, queued, interrupted…). */
export async function getJobs(): Promise<KeyedJob[]> {
  const res = await send({ type: 'GET_JOBS' });
  return res?.ok && 'jobs' in res ? res.jobs : [];
}

/**
 * Starts (or joins) the job for `video`. Resolves with the state of the job
 * actually handling it — its `videoId` differs from `video.id` when the video
 * was already running under another local id.
 */
export async function requestSummary(
  video: DetectedVideo,
  { force = false }: { force?: boolean } = {},
): Promise<JobState | null> {
  // `force`: regenerate — the worker skips the saved summary and pays for a new one.
  const res = await send(
    force ? { type: 'SUMMARIZE', video, force } : { type: 'SUMMARIZE', video },
  );
  return res?.ok && 'state' in res ? res.state : null;
}

export async function cancel(videoId: string): Promise<void> {
  await send({ type: 'CANCEL', videoId });
}

export async function requestBatch(videos: DetectedVideo[]): Promise<void> {
  await send({ type: 'SUMMARIZE_BATCH', videos });
}

/** Full diagnostic report text (local, keys redacted) built by the worker. Throws on refusal or transport failure. */
export async function getDiagnosticReport(): Promise<string> {
  const res = await send({ type: 'GET_DIAGNOSTICS' });
  if (!res || !res.ok) throw new Error(res && !res.ok ? res.message : 'no response');
  if (!('report' in res)) throw new Error('unexpected response');
  return res.report;
}

/** Wipes the persisted logs. Throws on refusal or transport failure. */
export async function clearLogs(): Promise<void> {
  const res = await send({ type: 'CLEAR_LOGS' });
  if (!res || !res.ok) throw new Error(res && !res.ok ? res.message : 'no response');
}
