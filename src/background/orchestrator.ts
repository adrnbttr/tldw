import type {
  BatchItemResult,
  BatchState,
  DetectedVideo,
  JobState,
  JobProgress,
  JobStep,
  JobStepStatus,
  Summary,
} from '@/types';
import { TldwError, messageFor } from '@/types';
import { selectAdapter } from '@/adapters';
import { audioTranscriber } from '@/transcription';
import { summarize } from '@/summarizer';
import { getSettings, saveSummary, findCachedSummary } from '@/storage';

/**
 * Job orchestration — the best-effort cascade (spec §2.1).
 *
 * Level 1: provider adapter captions. On NO_CAPTIONS_AVAILABLE, drop to
 * Level 2: audio transcription fallback. Then summarize. Every step broadcasts
 * progress so the popup can render it (F2). Jobs live in the service worker, so
 * closing the popup does not stop them.
 */

const jobs = new Map<string, JobState>();
const jobVideos = new Map<string, DetectedVideo>();
const controllers = new Map<string, AbortController>();
let lastJobId: string | null = null;

type Broadcaster = (state: JobState, progress?: JobProgress) => void;

const STEPS: JobStep[] = ['detect', 'captions', 'audio_capture', 'transcription', 'summarize'];

function initialSteps(videoId: string): JobProgress[] {
  return STEPS.map((step, i) => ({
    videoId,
    step,
    status: (i === 0 ? 'done' : 'pending') as JobStepStatus,
  }));
}

export function getJobState(videoId: string): JobState {
  return jobs.get(videoId) ?? { phase: 'idle' };
}

/**
 * The most recent job together with its video, so the popup can restore the
 * processing view after being closed and reopened — even though a re-scan of the
 * page assigns fresh local ids (F2, "state restored on reopen").
 */
export function getActiveJob(): { video: DetectedVideo; state: JobState } | null {
  if (!lastJobId) return null;
  const video = jobVideos.get(lastJobId);
  const state = jobs.get(lastJobId);
  return video && state ? { video, state } : null;
}

let batchState: BatchState = { phase: 'idle' };

export function getBatchState(): BatchState {
  return batchState;
}

/**
 * Batch processing (F8). Runs each video's job sequentially in the worker and
 * aggregates the outcomes, so the popup can close and reopen mid-run.
 */
export async function runBatch(
  videos: DetectedVideo[],
  broadcast: Broadcaster,
  broadcastBatch: (state: BatchState) => void,
): Promise<void> {
  const results: BatchItemResult[] = [];
  const summaries: Summary[] = [];

  const push = (currentTitle: string | null) => {
    batchState = {
      phase: 'running',
      total: videos.length,
      completed: results.length,
      currentTitle,
      results: [...results],
    };
    broadcastBatch(batchState);
  };

  push(videos[0]?.title ?? null);

  for (const video of videos) {
    push(video.title);
    await runJob(video, broadcast);
    const state = getJobState(video.id);
    if (state.phase === 'done') {
      summaries.push(state.summary);
      results.push({ videoId: video.id, title: state.summary.title, ok: true });
    } else if (state.phase === 'error') {
      results.push({
        videoId: video.id,
        title: video.title ?? 'Untitled video',
        ok: false,
        code: state.code,
        message: state.message,
      });
    }
  }

  batchState = { phase: 'done', total: videos.length, results, summaries };
  broadcastBatch(batchState);
}

export function cancelJob(videoId: string): void {
  controllers.get(videoId)?.abort();
  controllers.delete(videoId);
}

export async function runJob(video: DetectedVideo, broadcast: Broadcaster): Promise<void> {
  const controller = new AbortController();
  controllers.set(video.id, controller);
  jobVideos.set(video.id, video);
  lastJobId = video.id;
  const { signal } = controller;

  const steps = initialSteps(video.id);
  const setStep = (step: JobStep, status: JobStepStatus, detail?: string) => {
    const entry = steps.find((s) => s.step === step);
    if (!entry) return;
    entry.status = status;
    entry.detail = detail;
    const state: JobState = { phase: 'running', videoId: video.id, steps: [...steps] };
    jobs.set(video.id, state);
    broadcast(state, entry);
  };

  jobs.set(video.id, { phase: 'running', videoId: video.id, steps });
  broadcast({ phase: 'running', videoId: video.id, steps });

  try {
    const settings = await getSettings();

    // Cache hit — skip processing entirely (spec §3.9).
    const cached = await findCachedSummary(video.provider, video.externalId);
    if (cached) {
      const done: JobState = { phase: 'done', videoId: video.id, summary: cached };
      jobs.set(video.id, done);
      broadcast(done);
      return;
    }

    const transcript = await extract(video, settings, signal, setStep);

    setStep('summarize', 'active');
    const summary = await summarize(transcript, settings, signal);
    setStep('summarize', 'done');

    await saveSummary(video.provider, video.externalId, summary);

    const done: JobState = { phase: 'done', videoId: video.id, summary };
    jobs.set(video.id, done);
    broadcast(done);
  } catch (err) {
    const code = err instanceof TldwError ? err.code : 'UNKNOWN';
    const detail = err instanceof TldwError ? err.providerMessage : undefined;
    const state: JobState = {
      phase: 'error',
      videoId: video.id,
      code,
      message: messageFor(err),
      detail: detail?.slice(0, 600),
    };
    jobs.set(video.id, state);
    broadcast(state);
  } finally {
    controllers.delete(video.id);
  }
}

async function extract(
  video: DetectedVideo,
  settings: Awaited<ReturnType<typeof getSettings>>,
  signal: AbortSignal,
  setStep: (step: JobStep, status: JobStepStatus, detail?: string) => void,
) {
  const adapter = selectAdapter(video);

  // Level 1 — captions (only when a provider adapter exists).
  if (adapter) {
    setStep('captions', 'active');
    try {
      const transcript = await adapter.extractCaptions(video, signal);
      setStep('captions', 'done');
      setStep('audio_capture', 'skipped');
      setStep('transcription', 'skipped');
      return transcript;
    } catch (err) {
      if (!(err instanceof TldwError) || err.code !== 'NO_CAPTIONS_AVAILABLE') throw err;
      setStep('captions', 'failed');
    }
  } else {
    // Native <video> / no caption source: skip straight to the audio fallback.
    setStep('captions', 'skipped');
  }

  // Level 2 — audio fallback.
  setStep('audio_capture', 'active');
  setStep('transcription', 'active');
  const transcript = await audioTranscriber.transcribe(
    video,
    settings,
    (detail) => setStep('transcription', 'active', detail),
    signal,
  );
  setStep('audio_capture', 'done');
  setStep('transcription', 'done');
  return transcript;
}
