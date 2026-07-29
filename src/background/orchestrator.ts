import type {
  BatchItemResult,
  BatchState,
  DetailLevel,
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

/** What a finished job needs to re-summarize at a new length, cheaply. */
type RegenSource =
  { kind: 'transcript'; transcript: Transcript } | { kind: 'youtube'; video: DetectedVideo };
const regenSources = new Map<string, RegenSource>();

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

export async function runJob(
  video: DetectedVideo,
  broadcast: Broadcaster,
  detailOverride?: DetailLevel,
): Promise<void> {
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
    const base = await getSettings();
    const settings = detailOverride ? { ...base, detailLevel: detailOverride } : base;

    // Cache hit — skip processing entirely (spec §3.9). Skip when regenerating.
    const cached = detailOverride
      ? null
      : await findCachedSummary(video.provider, video.externalId);
    if (cached) {
      const done: JobState = { phase: 'done', videoId: video.id, summary: cached };
      jobs.set(video.id, done);
      broadcast(done);
      return;
    }

    const transcript = await extract(video, settings, signal, setStep);

    // Remember the source so the popup can regenerate at a new length cheaply.
    regenSources.set(
      video.id,
      transcript ? { kind: 'transcript', transcript } : { kind: 'youtube', video },
    );

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

/**
 * Re-summarizes an existing result at a new length, in place. Reuses the cached
 * source (transcript, or the YouTube video) so only the LLM runs — no re-download
 * or re-transcription. Falls back to a fresh run if the source was evicted.
 */
export async function regenerate(
  videoId: string,
  detailLevel: DetailLevel,
  broadcast: Broadcaster,
): Promise<void> {
  const src = regenSources.get(videoId);
  const video = jobVideos.get(videoId);
  try {
    const settings = { ...(await getSettings()), detailLevel };
    let summary: Summary;
    if (src?.kind === 'transcript') {
      summary = await summarize(src.transcript, settings);
    } else if (src?.kind === 'youtube') {
      summary = await summarizeYouTubeVideo(src.video, settings);
    } else if (video) {
      await runJob(video, broadcast, detailLevel);
      return;
    } else {
      throw new TldwError('UNKNOWN', 'Nothing to regenerate.');
    }
    if (video) await saveSummary(video.provider, video.externalId, summary);
    const done: JobState = { phase: 'done', videoId, summary };
    jobs.set(videoId, done);
    broadcast(done);
  } catch (err) {
    const code = err instanceof TldwError ? err.code : 'UNKNOWN';
    const detail = err instanceof TldwError ? err.providerMessage : undefined;
    const state: JobState = {
      phase: 'error',
      videoId,
      code,
      message: messageFor(err),
      detail: detail?.slice(0, 600),
    };
    jobs.set(videoId, state);
    broadcast(state);
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
