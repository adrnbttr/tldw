import type {
  BatchItemResult,
  BatchState,
  DetectedVideo,
  JobState,
  JobProgress,
  JobStep,
  JobStepStatus,
  Summary,
  Transcript,
} from '@/types';
import { TldwError, messageFor } from '@/types';
import { selectAdapter } from '@/adapters';
import { audioTranscriber } from '@/transcription';
import { summarize, summarizeYouTubeVideo } from '@/summarizer';
import { getCatalog, isLocale } from '@/i18n';
import { getSettings, saveSummary, findCachedSummary } from '@/storage';
import { markInterrupted, sessionJobStore, snapshotOf } from './job-store';
import type { JobStore } from './job-store';
import { log } from './log';
import { loggableUrl } from './loggable-url';

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

/**
 * Best-effort persistence: mirror the live state to session storage so a
 * restarted worker can report what happened. Fire-and-forget — a failed or
 * slow write must never break a job in flight.
 */
function commit(): void {
  sessionJobStore.save(snapshotOf(jobs, lastJobId)).catch(() => {
    // Storage unavailable (quota, transient failure) — in-memory state is
    // still authoritative for this worker's lifetime.
  });
}

/**
 * Hydrate the in-memory state from the store on worker wake-up. Any job that
 * was still `running` when the previous worker died is converted to a typed
 * INTERRUPTED error, retryable from the popup's existing error rendering.
 * A failed read leaves the worker running clean rather than crashing it.
 */
export async function restoreJobs(store: JobStore = sessionJobStore): Promise<void> {
  try {
    const loaded = await store.load();
    const snapshot = markInterrupted(loaded);
    for (const [videoId, state] of Object.entries(snapshot.jobs)) {
      jobs.set(videoId, state);
      // This job was still `running` in the store — markInterrupted just
      // converted it: the previous worker died mid-job, worth a warn line.
      if (loaded.jobs[videoId]?.phase === 'running') {
        log.warn('job interrupted by worker restart', { videoId });
      }
    }
    lastJobId = snapshot.lastJobId;
  } catch {
    // Unreadable store — start from idle.
  }
}

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
  const startedAt = Date.now();
  log.info('job started', {
    videoId: video.id,
    provider: video.provider,
    url: loggableUrl(video.iframeSrc ?? video.mediaSrc),
  });

  const steps = initialSteps(video.id);
  const setStep = (step: JobStep, status: JobStepStatus, detail?: string) => {
    const entry = steps.find((s) => s.step === step);
    if (!entry) return;
    entry.status = status;
    entry.detail = detail;
    const state: JobState = { phase: 'running', videoId: video.id, steps: [...steps] };
    jobs.set(video.id, state);
    commit();
    broadcast(state, entry);
    log.debug('job step', { videoId: video.id, step, status, detail });
  };

  jobs.set(video.id, { phase: 'running', videoId: video.id, steps });
  commit();
  broadcast({ phase: 'running', videoId: video.id, steps });

  try {
    const settings = await getSettings();

    // Cache hit — skip processing entirely (spec §3.9).
    const cached = await findCachedSummary(video.provider, video.externalId);
    if (cached) {
      const done: JobState = { phase: 'done', videoId: video.id, summary: cached };
      jobs.set(video.id, done);
      commit();
      broadcast(done);
      log.info('job done', {
        videoId: video.id,
        provider: video.provider,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const transcript = await extract(video, settings, signal, setStep);

    // null transcript → YouTube captions unavailable: Gemini watches the URL.
    let summary: Summary;
    if (transcript) {
      setStep('summarize', 'active');
      summary = await summarize(transcript, settings, signal);
    } else {
      const loc = isLocale(settings.uiLanguage) ? settings.uiLanguage : 'en';
      setStep('summarize', 'active', getCatalog(loc).processing.analyzingVideo);
      summary = await summarizeYouTubeVideo(video, settings, signal);
    }
    setStep('summarize', 'done');

    await saveSummary(video.provider, video.externalId, summary);

    const done: JobState = { phase: 'done', videoId: video.id, summary };
    jobs.set(video.id, done);
    commit();
    broadcast(done);
    log.info('job done', {
      videoId: video.id,
      provider: video.provider,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    const code = err instanceof TldwError ? err.code : 'UNKNOWN';
    const detail = err instanceof TldwError ? err.providerMessage : undefined;
    log.error('job failed', {
      videoId: video.id,
      provider: video.provider,
      code,
      providerMessage: detail,
      stack: err instanceof Error ? err.stack : undefined,
      durationMs: Date.now() - startedAt,
    });
    const state: JobState = {
      phase: 'error',
      videoId: video.id,
      code,
      message: messageFor(err),
      detail: detail?.slice(0, 600),
    };
    jobs.set(video.id, state);
    commit();
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
): Promise<Transcript | null> {
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
      const noCaptions =
        err instanceof TldwError &&
        (err.code === 'NO_CAPTIONS_AVAILABLE' || err.code === 'CAPTIONS_BLOCKED');
      if (!noCaptions) throw err;
      setStep('captions', 'failed');
      // YouTube blocks caption downloads and its media can't be captured — let
      // Gemini watch the video URL instead (null → the video-summary path).
      if (video.provider === 'youtube') {
        // Recovered seamlessly — don't alarm the user with a red failure.
        setStep('captions', 'skipped');
        setStep('audio_capture', 'skipped');
        setStep('transcription', 'skipped');
        return null;
      }
    }
  } else {
    // Native <video> / no caption source: skip straight to the audio fallback.
    setStep('captions', 'skipped');
  }

  // Level 2 — audio fallback.
  setStep('audio_capture', 'active');
  const transcript = await audioTranscriber.transcribe(
    video,
    settings,
    (detail, phase) => {
      if (phase === 'transcribe') {
        setStep('audio_capture', 'done');
        setStep('transcription', 'active', detail);
      } else {
        setStep('audio_capture', 'active', detail);
      }
    },
    signal,
  );
  setStep('audio_capture', 'done');
  setStep('transcription', 'done');
  return transcript;
}
