import type {
  DetectedVideo,
  JobState,
  JobProgress,
  JobStep,
  JobStepStatus,
  ProgressData,
  Settings,
  Summary,
  Transcript,
} from '@/types';
import { DEFAULT_SETTINGS, ERROR_MESSAGES, TldwError, messageFor } from '@/types';
import { selectAdapter } from '@/adapters';
import { audioTranscriber } from '@/transcription';
import { summarize, summarizeYouTubeVideo } from '@/summarizer';
import { getCatalog, isLocale } from '@/i18n';
import { getSettings, saveSummary, findCachedSummary, findSummaryByKey } from '@/storage';
import type { VideoRef } from '@/storage';
import { videoKey } from '@/shared/video-key';
import { createProgressTracker } from '@/shared/job-progress';
import type { ProgressTracker, SummaryPath } from '@/shared/job-progress';
import { markInterrupted, sessionJobStore } from './job-store';
import type {
  CachedSummaryRef,
  JobStore,
  JobsSnapshot,
  StoredJobState,
  StoredSnapshot,
} from './job-store';
import { holdKeepalive } from './keepalive';
import { log } from './log';
import { loggableUrl } from './loggable-url';

/**
 * Job orchestration — the best-effort cascade (spec §2.1).
 *
 * Level 1: provider adapter captions. On NO_CAPTIONS_AVAILABLE, drop to
 * Level 2: audio transcription fallback. Then summarize. Every step broadcasts
 * progress so the popup can render it (F2). Jobs live in the service worker, so
 * closing the popup does not stop them.
 *
 * State: one `Job` per job id (the local id of the video it was started for)
 * in `jobs`, plus `liveByKey` (stable video key → id of the job running or
 * queued for it) for de-duplication. A job's `run` is its live execution; a
 * cancelled job loses its run at once, and every write a run makes is checked
 * against the job's current run — an aborted run unwinding in the background
 * (or a relaunch under the same id) can never be overwritten by it.
 */

export type Broadcaster = (state: JobState) => void;

/** One execution of a job (absent once settled or cancelled). */
interface Run {
  controller: AbortController;
  broadcast: Broadcaster;
  done: Promise<void>;
}

interface Job {
  id: string;
  /** null for jobs restored from storage (only their state survives). */
  video: DetectedVideo | null;
  /** Stable video key (shared/video-key.ts); null for very old snapshots. */
  key: string | null;
  tabId?: number;
  state: JobState;
  /** Set when the summary was saved: what a persisted done job points to. */
  cached?: CachedSummaryRef;
  /** Skip the cache lookup (regenerate). */
  force?: boolean;
  startedAt: number;
  updatedAt: number;
  run?: Run;
}

const jobs = new Map<string, Job>();
/** Stable video key → id of the job running or queued for it. */
const liveByKey = new Map<string, string>();

/** Bound on the jobs kept (memory and snapshot): oldest terminal ones go first. */
const MAX_JOBS = 50;
/** Terminal jobs older than this are dropped. */
const MAX_JOB_AGE_MS = 6 * 3600 * 1000;

function prune(now = Date.now()): void {
  const terminal = [...jobs.values()]
    .filter((j) => !j.run)
    .sort((a, b) => a.updatedAt - b.updatedAt);
  let excess = jobs.size - MAX_JOBS;
  for (const job of terminal) {
    if (excess > 0 || now - job.updatedAt > MAX_JOB_AGE_MS) {
      jobs.delete(job.id);
      excess--;
    }
  }
}

function lastJobId(): string | null {
  let last: Job | null = null;
  for (const job of jobs.values()) if (!last || job.startedAt >= last.startedAt) last = job;
  return last?.id ?? null;
}

/** What is persisted: done jobs as a reference to their cached summary. */
function storedSnapshot(): StoredSnapshot {
  const out: Record<string, StoredJobState> = {};
  const keys: Record<string, string> = {};
  for (const job of jobs.values()) {
    if (job.state.phase === 'done') {
      // A summary that could not be saved has no reference to restore it from.
      if (!job.cached) continue;
      out[job.id] = { phase: 'done', videoId: job.id, cached: job.cached };
    } else {
      out[job.id] = job.state;
    }
    if (job.key) keys[job.id] = job.key;
  }
  return { jobs: out, lastJobId: lastJobId(), keys };
}

let storeFailing = false;

/**
 * Best-effort persistence: mirror the live state to session storage so a
 * restarted worker can report what happened. Fire-and-forget — a failed or
 * slow write must never break a job in flight, but it is logged (once per
 * failure streak) instead of swallowed.
 */
function commit(): void {
  prune();
  sessionJobStore.save(storedSnapshot()).then(
    () => {
      storeFailing = false;
    },
    (err: unknown) => {
      if (storeFailing) return;
      storeFailing = true;
      log.warn('job state not persisted', { error: String(err) });
    },
  );
}

/**
 * Hydrate the in-memory state from the store on worker wake-up. Any job that
 * was still `running` when the previous worker died is converted to a typed
 * INTERRUPTED error, retryable from the popup's existing error rendering. A
 * done job is rehydrated from its cached summary (dropped if it is gone).
 * A failed read leaves the worker running clean rather than crashing it.
 */
export async function restoreJobs(store: JobStore = sessionJobStore): Promise<void> {
  try {
    const loaded = await store.load();
    const snapshot = markInterrupted(loaded);
    const now = Date.now();
    for (const [videoId, stored] of Object.entries(snapshot.jobs)) {
      // This job was still `running` in the store — markInterrupted just
      // converted it: the previous worker died mid-job, worth a warn line.
      if (loaded.jobs[videoId]?.phase === 'running') {
        log.warn('job interrupted by worker restart', { videoId });
      }
      let state: JobState | null;
      if (stored.phase === 'done') {
        const ref = stored.cached;
        const summary =
          stored.summary ??
          (ref?.historyKey
            ? await findSummaryByKey(ref.historyKey).catch(() => null)
            : ref
              ? await findCachedSummary(ref.provider, ref.externalId, ref.ref).catch(() => null)
              : null);
        state = summary ? { phase: 'done', videoId, summary } : null;
      } else state = stored;
      if (!state || jobs.has(videoId)) continue;
      jobs.set(videoId, {
        id: videoId,
        video: null,
        key: snapshot.keys?.[videoId] ?? null,
        state,
        ...(stored.phase === 'done' && stored.cached ? { cached: stored.cached } : {}),
        startedAt: videoId === snapshot.lastJobId ? now : now - 1,
        updatedAt: now,
      });
    }
  } catch {
    // Unreadable store — start from idle.
  }
}

const STEPS: JobStep[] = ['detect', 'captions', 'audio_capture', 'transcription', 'summarize'];

function initialSteps(videoId: string): JobProgress[] {
  return STEPS.map((step, i) => ({
    videoId,
    step,
    status: (i === 0 ? 'done' : 'pending') as JobStepStatus,
  }));
}

export function getJobState(videoId: string): JobState {
  return jobs.get(videoId)?.state ?? { phase: 'idle' };
}

/**
 * The whole live picture at once, for the diagnostic report
 * (src/shared/diagnostics.ts) — unlike a raw session-store read, this reflects
 * the post-restore state a revived worker actually holds (INTERRUPTED
 * instead of stale `running`), done summaries included.
 */
export function getJobsSnapshot(): JobsSnapshot {
  const states: Record<string, JobState> = {};
  const keys: Record<string, string> = {};
  for (const job of jobs.values()) {
    states[job.id] = job.state;
    if (job.key) keys[job.id] = job.key;
  }
  return { jobs: states, lastJobId: lastJobId(), keys };
}

/**
 * Every known job of this browser session with its stable video key — the
 * popup matches them to the videos it lists (fresh local ids after a re-scan),
 * so a running, queued or INTERRUPTED job shows on its video. Survives worker
 * restarts (keys and states are persisted).
 */
export function getKeyedJobs(): Array<{ key: string; state: JobState }> {
  const out: Array<{ key: string; state: JobState }> = [];
  for (const job of jobs.values()) if (job.key) out.push({ key: job.key, state: job.state });
  return out;
}

/** Id of the job already running or queued for this video, if any. */
export function runningJobIdFor(video: DetectedVideo): string | null {
  return liveByKey.get(videoKey(video)) ?? null;
}

/**
 * Batch processing (F8). Every video is registered at once — each shows as a
 * queued job (cancellable, de-duplicated, listed by GET_JOBS) — and they run
 * one after the other in the worker, so the popup can close and reopen
 * mid-run. A video already running or queued is joined, not run twice.
 */
export async function runBatch(
  videos: DetectedVideo[],
  broadcast: Broadcaster,
  options: RunOptions = {},
): Promise<void> {
  let previous: Promise<unknown> = Promise.resolve();
  const all: Array<Promise<string>> = [];
  videos.forEach((video, index) => {
    const handled = runJob(video, broadcast, { ...options, after: previous, ahead: index });
    all.push(handled);
    previous = handled;
  });
  await Promise.allSettled(all);
}

/**
 * Cancels a running or queued job — synchronously: the run is detached and
 * aborted, its video is free to be launched again at once (a relaunch starts a
 * fresh job instead of joining the dying one), and the job settles to a
 * neutral CANCELLED state. Whatever the aborted run still produces while it
 * unwinds is dropped (see `Run`).
 */
export function cancelJob(videoId: string): void {
  const job = jobs.get(videoId);
  const run = job?.run;
  if (!job || !run) return;
  job.run = undefined;
  if (job.key && liveByKey.get(job.key) === videoId) liveByKey.delete(job.key);
  run.controller.abort();
  const state: JobState = {
    phase: 'error',
    videoId,
    code: 'CANCELLED',
    message: ERROR_MESSAGES.CANCELLED,
  };
  job.state = state;
  job.updatedAt = Date.now();
  commit();
  run.broadcast(state);
  log.info('job cancelled', { videoId });
}

export interface RunOptions {
  /**
   * Tab the request came from, fixed when it was received: the audio fallback
   * captures from (and primes) this tab only, and page fetches go through it,
   * whatever tab is active later.
   */
  tabId?: number;
  /** Start only once this settles (batch: the previous item). */
  after?: Promise<unknown>;
  /** Items ahead in the batch, shown while waiting for `after`. */
  ahead?: number;
  /** Bypass the summary cache (the user asked to regenerate). */
  force?: boolean;
}

/**
 * Runs (or joins) the job for `video`; resolves with the id of the job that
 * handled it. Launching a video that is already running or queued — even under
 * a fresh local id after a re-scan — joins the existing job instead of paying
 * twice. The registration is synchronous, before the first await, so two
 * near-simultaneous requests cannot both start.
 */
export function runJob(
  video: DetectedVideo,
  broadcast: Broadcaster,
  options: RunOptions = {},
): Promise<string> {
  const key = videoKey(video);
  const liveId = liveByKey.get(key);
  const live = liveId != null ? jobs.get(liveId)?.run : undefined;
  if (liveId != null && live) {
    log.info('job already running, joined', { videoId: video.id, jobId: liveId });
    return live.done.then(() => liveId);
  }
  // A new run supersedes this video's previous terminal states.
  for (const job of jobs.values()) {
    if (job.key === key && job.id !== video.id && !job.run) jobs.delete(job.id);
  }

  const now = Date.now();
  const waiting = options.after != null && (options.ahead ?? 0) > 0;
  const initial: JobState = {
    phase: 'running',
    videoId: video.id,
    steps: initialSteps(video.id),
    progress: waiting
      ? { percent: 0, phase: 'queued', ahead: options.ahead }
      : createProgressTracker().snapshot(),
  };
  const run = { controller: new AbortController(), broadcast } as Run;
  // A previous job of this very id (cancelled, still unwinding) is replaced.
  const job: Job = {
    id: video.id,
    video,
    key,
    tabId: options.tabId,
    force: options.force === true,
    state: initial,
    startedAt: now,
    updatedAt: now,
    run,
  };
  jobs.set(video.id, job);
  liveByKey.set(key, video.id);
  commit();
  broadcast(initial);

  const release = holdKeepalive();
  run.done = (async () => {
    try {
      // Sequencing only: whatever the previous item became does not matter.
      if (options.after) await options.after.catch(() => {});
      await executeJob(job, run);
    } finally {
      release();
      if (job.run === run) job.run = undefined;
      if (liveByKey.get(key) === video.id && jobs.get(video.id) === job) liveByKey.delete(key);
    }
  })();
  return run.done.then(() => video.id);
}

function videoRef(
  video: DetectedVideo,
  settings: { outputLanguage: string; summaryModel: string },
): VideoRef {
  return {
    outputLanguage: settings.outputLanguage,
    summaryModel: settings.summaryModel,
    mediaSrc: video.mediaSrc,
    iframeSrc: video.iframeSrc,
  };
}

/** Positive seconds, else the default setting (never 0: it would time out at once). */
function baseTimeoutSeconds(settings: Settings): number {
  const s = settings.timeoutSeconds;
  return Number.isFinite(s) && s > 0 ? s : DEFAULT_SETTINGS.timeoutSeconds;
}

/** Hard ceiling of any one phase watchdog. */
const MAX_PHASE_SECONDS = 4 * 3600;

/**
 * Watchdog of one non-audio phase (captions, summary): `work` gets a signal
 * aborted by the user's cancel or by the deadline, and the phase settles as
 * soon as either fires — even if `work` ignores its signal (a stalled fetch
 * must not pin the job, and the worker's keepalive, forever). A deadline is a
 * typed TIMEOUT; a cancel rejects with whatever, the caller sees the job is
 * no longer live. The audio fallback has its own budgets (transcription/).
 */
async function withDeadline<T>(
  seconds: number,
  userSignal: AbortSignal,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutError = () => new TldwError('TIMEOUT', 'Processing step exceeded the time limit.');
  return new Promise<T>((resolve, reject) => {
    const onUserAbort = () => {
      controller.abort();
      reject(new TldwError('CANCELLED', 'Job cancelled.'));
    };
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
        reject(timeoutError());
      },
      Math.min(seconds, MAX_PHASE_SECONDS) * 1000,
    );
    const cleanup = () => {
      clearTimeout(timer);
      userSignal.removeEventListener('abort', onUserAbort);
    };
    if (userSignal.aborted) {
      cleanup();
      onUserAbort();
      return;
    }
    userSignal.addEventListener('abort', onUserAbort, { once: true });
    work(controller.signal).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (err: unknown) => {
        cleanup();
        reject(timedOut ? timeoutError() : err);
      },
    );
  });
}

async function executeJob(job: Job, run: Run): Promise<void> {
  const video = job.video as DetectedVideo;
  const { signal } = run.controller;
  /** Still the job's registered run (not cancelled, not superseded). */
  const live = () => jobs.get(job.id) === job && job.run === run;
  // Cancelled while queued behind another batch item.
  if (!live()) return;

  /** Broadcasts only while live: a dead run must not repaint the popup. */
  const broadcast: Broadcaster = (state) => {
    if (live()) run.broadcast(state);
  };
  /** Sets this job's state, only while live. */
  const setState = (state: JobState): boolean => {
    if (!live()) return false;
    job.state = state;
    job.updatedAt = Date.now();
    return true;
  };
  const startedAt = Date.now();
  job.startedAt = startedAt;
  log.info('job started', {
    videoId: video.id,
    provider: video.provider,
    url: loggableUrl(video.iframeSrc ?? video.mediaSrc),
  });

  const steps = initialSteps(video.id);

  // Progress bar (shared/job-progress.ts): recomputed on every phase event and
  // on a 500 ms tick (creeping phases). Pushed to the popup at most 4×/s and
  // persisted at most every 2 s — so are step *detail* updates (one per HLS
  // segment or range block: hundreds per job). Only a step *status* change
  // goes through immediately. A skipped push or write is flushed by the tick.
  const tracker = createProgressTracker();
  let snap = tracker.snapshot();
  let lastBroadcast = 0;
  let lastCommit = 0;
  let unbroadcast = false;
  let uncommitted = false;
  const runningState = (): JobState => ({
    phase: 'running',
    videoId: video.id,
    steps: [...steps],
    progress: snap,
  });
  const publishThrottled = () => {
    if (!setState(runningState())) return;
    const now = Date.now();
    if (now - lastBroadcast >= 250) {
      lastBroadcast = now;
      unbroadcast = false;
      broadcast(job.state);
    } else unbroadcast = true;
    if (now - lastCommit >= 2000) {
      lastCommit = now;
      uncommitted = false;
      commit();
    } else uncommitted = true;
  };
  const setStep = (step: JobStep, status: JobStepStatus, detail?: string) => {
    const entry = steps.find((s) => s.step === step);
    if (!entry) return;
    const statusChanged = entry.status !== status;
    if (!statusChanged && entry.detail === detail) return;
    entry.status = status;
    entry.detail = detail;
    if (!statusChanged) {
      publishThrottled();
      return;
    }
    if (!setState(runningState())) return;
    lastCommit = lastBroadcast = Date.now();
    uncommitted = unbroadcast = false;
    commit();
    broadcast(job.state);
    log.debug('job step', { videoId: video.id, step, status, detail });
  };
  const refreshProgress = () => {
    const next = tracker.snapshot();
    const changed =
      next.percent !== snap.percent ||
      next.phase !== snap.phase ||
      next.done !== snap.done ||
      next.etaSeconds !== snap.etaSeconds ||
      next.ahead !== snap.ahead;
    snap = next;
    if (changed || unbroadcast || uncommitted) publishThrottled();
  };
  const track = (phase: Parameters<ProgressTracker['set']>[0], data?: ProgressData) => {
    tracker.set(phase, data);
    refreshProgress();
  };
  const ticker = setInterval(refreshProgress, 500);

  setState(runningState());
  commit();
  broadcast(job.state);

  try {
    const settings = await getSettings();
    const ref = videoRef(video, settings);

    // Cache hit — skip processing entirely (spec §3.9). A regenerate request
    // (`force`) pays for a fresh summary, which then replaces the cached one.
    const cached = job.force
      ? null
      : await findCachedSummary(video.provider, video.externalId, ref);
    if (cached) {
      const done: JobState = { phase: 'done', videoId: video.id, summary: cached };
      if (!setState(done)) return;
      job.cached = { provider: video.provider, externalId: video.externalId, ref };
      commit();
      broadcast(done);
      log.info('job done', {
        videoId: video.id,
        provider: video.provider,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const transcript = await extract(video, settings, signal, setStep, track, job.tabId);
    if (!live()) return;

    // null transcript → YouTube captions unavailable: Gemini watches the URL.
    let summary: Summary;
    const summaryPath: SummaryPath = !transcript
      ? 'video'
      : transcript.source === 'audio_transcription'
        ? 'audio'
        : 'captions';
    tracker.beginSummary(summaryPath);
    refreshProgress();
    // Summary budget: the base timeout plus a quarter of the media duration
    // (long transcripts are summarized block by block).
    const summarySeconds =
      baseTimeoutSeconds(settings) + Math.max(0, (transcript?.duration ?? 0) / 4);
    if (transcript) {
      setStep('summarize', 'active');
      summary = await withDeadline(summarySeconds, signal, (s) =>
        summarize(transcript, settings, s),
      );
    } else {
      const loc = isLocale(settings.uiLanguage) ? settings.uiLanguage : 'en';
      setStep('summarize', 'active', getCatalog(loc).processing.analyzingVideo);
      summary = await withDeadline(summarySeconds, signal, (s) =>
        summarizeYouTubeVideo(video, settings, s),
      );
    }
    setStep('summarize', 'done');

    // Cancelled while the summary was being written: drop it.
    if (!live()) return;
    // Never cache under this video's id a summary whose audio could not be
    // tied to it (tab-wide captures from several players), nor one built from
    // a fraction of the video (media much shorter than the video's duration).
    // Both are still paid results: kept in history under a non-cacheable key,
    // which the done job points to (restored after a worker restart).
    const partial = transcript?.metadata.partial === true;
    const unattributed = transcript?.metadata.sourceAttributed === false;
    if (partial) summary = { ...summary, partial: true };
    if (unattributed || partial) {
      log.warn('summary not cached', {
        videoId: video.id,
        reason: unattributed ? 'audio source not attributable' : 'partial transcript',
      });
      const historyKey = await saveSummary(video.provider, video.externalId, summary, ref, {
        noCache: true,
      });
      job.cached = { provider: video.provider, externalId: video.externalId, ref, historyKey };
    } else {
      await saveSummary(video.provider, video.externalId, summary, ref);
      job.cached = { provider: video.provider, externalId: video.externalId, ref };
    }

    const done: JobState = { phase: 'done', videoId: video.id, summary };
    if (!setState(done)) return;
    commit();
    broadcast(done);
    log.info('job done', {
      videoId: video.id,
      provider: video.provider,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    if (!live()) {
      // Cancelled (or superseded): its CANCELLED state is already set; this
      // is just the aborted run unwinding.
      log.debug('cancelled job unwound', { videoId: video.id });
      return;
    }
    // An abort is a cancel whatever the layer made of it (TIMEOUT
    // "cancelled", raw AbortError, NO_CAPTIONS…). Only cancelJob aborts, and
    // it detaches the run first — this is a safety net.
    if (signal.aborted) {
      const state: JobState = {
        phase: 'error',
        videoId: video.id,
        code: 'CANCELLED',
        message: ERROR_MESSAGES.CANCELLED,
      };
      setState(state);
      commit();
      broadcast(state);
      return;
    }
    const code = err instanceof TldwError ? err.code : 'UNKNOWN';
    const detail = err instanceof TldwError ? err.providerMessage : undefined;
    const retryAfter = err instanceof TldwError ? err.retryAfter : undefined;
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
      ...(retryAfter != null ? { retryAfter, failedAt: Date.now() } : {}),
    };
    setState(state);
    commit();
    broadcast(state);
  } finally {
    clearInterval(ticker);
  }
}

async function extract(
  video: DetectedVideo,
  settings: Settings,
  signal: AbortSignal,
  setStep: (step: JobStep, status: JobStepStatus, detail?: string) => void,
  track: (phase: Parameters<ProgressTracker['set']>[0], data?: ProgressData) => void,
  tabId: number | undefined,
): Promise<Transcript | null> {
  const adapter = selectAdapter(video);

  // Level 1 — captions (only when a provider adapter exists).
  if (adapter) {
    setStep('captions', 'active');
    track('captions');
    try {
      const transcript = await withDeadline(baseTimeoutSeconds(settings), signal, (s) =>
        adapter.extractCaptions(video, s, { outputLanguage: settings.outputLanguage, tabId }),
      );
      setStep('captions', 'done');
      setStep('audio_capture', 'skipped');
      setStep('transcription', 'skipped');
      return transcript;
    } catch (err) {
      // Cancelled: never cascade into a fallback with an aborted signal.
      if (signal.aborted) throw err;
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

  // Level 2 — audio fallback (own budgets, see transcription/index.ts).
  setStep('audio_capture', 'active');
  track('download');
  const transcript = await audioTranscriber.transcribe(
    video,
    settings,
    (detail, phase, data) => {
      track(
        phase === 'transcribe'
          ? 'transcription'
          : phase === 'queued'
            ? 'queued'
            : phase === 'extract'
              ? 'extract'
              : 'download',
        data,
      );
      if (phase === 'transcribe') {
        setStep('audio_capture', 'done');
        setStep('transcription', 'active', detail);
      } else {
        setStep('audio_capture', 'active', detail);
      }
    },
    signal,
    { tabId },
  );
  setStep('audio_capture', 'done');
  setStep('transcription', 'done');
  return transcript;
}
