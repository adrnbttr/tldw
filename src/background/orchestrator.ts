import type { DetectedVideo, JobState, JobProgress, JobStep, JobStepStatus } from '@/types';
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
const controllers = new Map<string, AbortController>();

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

export function cancelJob(videoId: string): void {
  controllers.get(videoId)?.abort();
  controllers.delete(videoId);
}

export async function runJob(video: DetectedVideo, broadcast: Broadcaster): Promise<void> {
  const controller = new AbortController();
  controllers.set(video.id, controller);
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
    const state: JobState = {
      phase: 'error',
      videoId: video.id,
      code,
      message: messageFor(err),
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
  if (!adapter) {
    throw new TldwError('UNSUPPORTED_PROVIDER', `No adapter for provider ${video.provider}.`);
  }

  // Level 1 — captions.
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
