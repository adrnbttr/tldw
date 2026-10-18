import { useEffect, useState } from 'preact/hooks';
import type { DetectedVideo, JobPercent, JobState, Summary } from '@/types';
import { redactString } from '@/shared/logger';
import { formatDuration } from '@/shared/format';
import { useI18n } from '@/i18n/context';
import { cancel } from '../messaging';
import { useDiagnosticCopy } from '../diagnostic-actions';
import { etaLabel, phaseLabel, progressValueText } from '../progress-text';
import { retryAt, secondsLeft } from '../retry';
import type { BatchProgress } from '../batch';
import { providerLabel } from '../provider-label';

interface Props {
  videos: DetectedVideo[];
  /** False until the first video list arrived (skeleton meanwhile). */
  loaded: boolean;
  jobs: Record<string, JobState>;
  /** Progress of the current "Summarize all" run, null when none. */
  batch: BatchProgress | null;
  rescanning: boolean;
  onSummarize: (video: DetectedVideo) => void;
  /** Summarize a done video again, bypassing the saved summary. */
  onRegenerate: (video: DetectedVideo) => void;
  onSummarizeAll: (videos: DetectedVideo[]) => void;
  onView: (videoId: string) => void;
  onRescan: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

const treatable = (v: DetectedVideo) => v.provider !== 'unknown';

/** Error-row "copy report" link — own state, so the feedback shows only on its row. */
function CopyReportButton() {
  const t = useI18n();
  const { copied, failed, copyDiagnostic } = useDiagnosticCopy();
  return (
    <button class="diag-link" onClick={() => void copyDiagnostic()}>
      {failed ? t.settings.diagnosticFailed : copied ? t.result.copied : t.list.copyReport}
    </button>
  );
}

const SETTINGS_CODES = new Set([
  'INVALID_API_KEY',
  'INVALID_TRANSCRIPTION_KEY',
  'MODEL_UNAVAILABLE',
  'INSUFFICIENT_CREDITS',
  'MISSING_OPENROUTER_KEY',
  'MISSING_TRANSCRIPTION_KEY',
]);
const CREDITS_URL = 'https://openrouter.ai/credits';

/** Re-renders every `ms` while `active` and returns the current time. */
function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/**
 * One compact block for a running job: phase text (step label until the first
 * measure) + percent + cancel on line 1, slim bar, then a reserved ETA line so
 * the row never jumps when progress or the ETA appear.
 */
function JobProgressBar({
  progress,
  fallbackText,
  tooltip,
  onCancel,
}: {
  progress?: JobPercent;
  /** Step label shown while no progress measure exists yet. */
  fallbackText: string;
  /** Full text (step + detail) for the hover tooltip. */
  tooltip: string;
  onCancel: () => void;
}) {
  const t = useI18n();
  const phase = progress ? phaseLabel(progress, t) : fallbackText;
  const eta = progress ? etaLabel(progress, t) : null;
  return (
    <div class="job-progress">
      <div class="job-progress-head">
        <span class="job-progress-phase" title={tooltip}>
          {phase}
        </span>
        {progress && <span class="job-progress-pct">{t.progress.percent(progress.percent)}</span>}
        <button class="cancel-link" onClick={onCancel}>
          {t.processing.cancel}
        </button>
      </div>
      <div
        class={`job-progress-track ${progress ? '' : 'indeterminate'}`}
        role="progressbar"
        aria-label={t.progress.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress?.percent}
        aria-valuetext={progressValueText(progress, t)}
      >
        <div class="job-progress-fill" style={progress ? { width: `${progress.percent}%` } : {}} />
      </div>
      <span class="job-progress-eta">{eta ?? '\u00A0'}</span>
    </div>
  );
}

/**
 * Failed job: full-width message, then its actions (retry, settings, credits,
 * report), then the collapsible (redacted) provider detail.
 */
function ErrorRow({
  job,
  onRetry,
  onOpenSettings,
}: {
  job: Extract<JobState, { phase: 'error' }>;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const t = useI18n();
  const detail = job.detail ? redactString(job.detail) : '';
  const until = job.code === 'RATE_LIMITED' ? retryAt(job) : null;
  const now = useNow(until != null && until > Date.now());
  const wait = secondsLeft(until, now);
  return (
    <div class="row-error-block">
      <p class="err">
        {t.errors[job.code]}
        {wait != null && <span class="err-wait"> {t.list.retryIn(wait)}</span>}
      </p>
      <div class="row-actions">
        <button class="secondary small" onClick={onRetry}>
          {t.list.retry}
        </button>
        {SETTINGS_CODES.has(job.code) && (
          <button class="diag-link" onClick={onOpenSettings}>
            {t.list.openSettings}
          </button>
        )}
        {job.code === 'INSUFFICIENT_CREDITS' && (
          <a class="diag-link" href={CREDITS_URL} target="_blank" rel="noreferrer">
            {t.list.addCredits}
          </a>
        )}
        <CopyReportButton />
      </div>
      {detail && (
        <details class="err-details">
          <summary>{t.list.technicalDetails}</summary>
          <pre>{detail}</pre>
        </details>
      )}
    </div>
  );
}

/** Placeholder cards while the first video list loads. */
function ListSkeleton() {
  const t = useI18n();
  return (
    <ul class="video-list skeleton" aria-busy="true" aria-label={t.list.loading}>
      {[0, 1].map((i) => (
        <li key={i} class="video-item" aria-hidden="true">
          <div class="sk-line sk-title" />
          <div class="sk-line sk-sub" />
          <div class="sk-line sk-btn" />
        </li>
      ))}
    </ul>
  );
}

/** No video on the page: what to do, a rescan button, what works. */
function EmptyState({ rescanning, onRescan }: { rescanning: boolean; onRescan: () => void }) {
  const t = useI18n();
  return (
    <div class="empty">
      <div class="empty-icon" aria-hidden="true">
        🎬
      </div>
      <p class="empty-title">{t.list.emptyTitle}</p>
      <p class="empty-hint">{t.list.emptyHint}</p>
      <button class="secondary small" disabled={rescanning} onClick={onRescan}>
        <span class={rescanning ? 'spin-inline' : ''} aria-hidden="true">
          ⟳
        </span>{' '}
        {t.list.rescan}
      </button>
      <p class="empty-sites">{t.list.emptySites}</p>
    </div>
  );
}

export function VideoList({
  videos,
  loaded,
  jobs,
  batch,
  rescanning,
  onSummarize,
  onRegenerate,
  onSummarizeAll,
  onView,
  onRescan,
  onOpenSettings,
  onOpenHistory,
}: Props) {
  const t = useI18n();
  const [exportFailed, setExportFailed] = useState(false);

  const doneSummaries: Summary[] = videos
    .map((v) => jobs[v.id])
    .filter((s): s is Extract<JobState, { phase: 'done' }> => s?.phase === 'done')
    .map((s) => s.summary);
  const doneCount = doneSummaries.length;

  const pending = videos.filter((v) => treatable(v) && !jobs[v.id]);

  const downloadAll = () => {
    import('../export-pdf')
      .then((m) => m.downloadPdfBatch(doneSummaries))
      .catch(() => {
        setExportFailed(true);
        setTimeout(() => setExportFailed(false), 1500);
      });
  };

  const body = () => {
    if (!loaded) return <ListSkeleton />;
    if (videos.length === 0) return <EmptyState rescanning={rescanning} onRescan={onRescan} />;
    return (
      <>
        <p class="overview">{t.list.overview(videos.length, doneCount)}</p>

        {/* Only for an actual "Summarize all" run — never for videos started one by one. */}
        {batch && (
          <div class="batch-progress">
            <div
              class="progress-track"
              role="progressbar"
              aria-label={t.batch.heading}
              aria-valuemin={0}
              aria-valuemax={batch.total}
              aria-valuenow={batch.settled}
              aria-valuetext={t.batch.progress(batch.settled, batch.total)}
            >
              <div
                class="progress-fill"
                style={{ width: `${(batch.settled / batch.total) * 100}%` }}
              />
            </div>
            <span class="batch-count">{t.list.batchProgress(batch.settled, batch.total)}</span>
          </div>
        )}

        <ul class="video-list">
          {videos.map((video) => {
            const job = jobs[video.id];
            const activeStep =
              job?.phase === 'running' ? job.steps.find((s) => s.status === 'active') : undefined;
            const runningText = activeStep
              ? `${t.processing.steps[activeStep.step]}${activeStep.detail ? ` · ${activeStep.detail}` : ''}`
              : job?.phase === 'running' && job.progress?.phase === 'queued'
                ? t.transcription.queued
                : t.progress.starting;
            const title = video.title ?? t.list.noTitle;
            const isDone = job?.phase === 'done';
            const hasSub = video.duration != null || !treatable(video);
            return (
              <li key={video.id} class={`video-item ${isDone ? 'done' : ''}`}>
                <div class="video-meta">
                  <span class={`badge badge-${video.provider}`}>
                    {providerLabel(video.provider, t.list.videoLabel)}
                  </span>
                  <span class="video-title" title={title}>
                    {title}
                  </span>
                  {isDone && (
                    <span class="done-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </div>
                {hasSub && (
                  <div class="video-sub">
                    {video.duration != null && (
                      <span>{formatDuration(video.duration, t.locale)}</span>
                    )}
                    {!treatable(video) && <span class="warn">{t.list.untreatable}</span>}
                  </div>
                )}

                <div class="row-body">
                  {job?.phase === 'running' ? (
                    // The job may carry another local id (joined or restored job).
                    <JobProgressBar
                      progress={job.progress}
                      fallbackText={activeStep ? t.processing.steps[activeStep.step] : runningText}
                      tooltip={runningText}
                      onCancel={() => void cancel(job.videoId).catch(() => {})}
                    />
                  ) : job?.phase === 'done' ? (
                    <div class="row-done">
                      <button class="primary" onClick={() => onView(video.id)}>
                        {t.list.view}
                      </button>
                      <button class="secondary small" onClick={() => onRegenerate(video)}>
                        {t.list.regenerate}
                      </button>
                    </div>
                  ) : job?.phase === 'error' && job.code === 'CANCELLED' ? (
                    // Cancelled by the user: neutral, not an error — relaunchable.
                    <div class="row-cancelled">
                      <span class="cancelled-label">{t.errors.CANCELLED}</span>
                      <button class="secondary small" onClick={() => onSummarize(video)}>
                        {t.list.summarize}
                      </button>
                    </div>
                  ) : job?.phase === 'error' ? (
                    <ErrorRow
                      job={job}
                      onRetry={() => onSummarize(video)}
                      onOpenSettings={onOpenSettings}
                    />
                  ) : (
                    <button
                      class="primary"
                      disabled={!treatable(video)}
                      onClick={() => onSummarize(video)}
                    >
                      {t.list.summarize}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {pending.length > 1 && (
          <button class="primary batch-btn" onClick={() => onSummarizeAll(pending)}>
            {t.list.summarizeAll(pending.length)}
          </button>
        )}

        {doneSummaries.length > 1 && (
          <button class="secondary batch-btn" aria-live="polite" onClick={downloadAll}>
            {exportFailed ? t.result.failed : t.batch.downloadAll(doneSummaries.length)}
          </button>
        )}
      </>
    );
  };

  return (
    <div class="screen">
      <header class="topbar">
        <h1>tldw</h1>
        <button
          class={`icon-btn reload ${rescanning ? 'spinning' : ''}`}
          title={t.list.rescanTooltip}
          aria-label={t.list.rescanTooltip}
          disabled={rescanning}
          onClick={onRescan}
        >
          ⟳
        </button>
        <button
          class="icon-btn"
          title={t.list.historyTooltip}
          aria-label={t.list.historyTooltip}
          onClick={onOpenHistory}
        >
          🕘
        </button>
        <button
          class="icon-btn"
          title={t.list.settingsTooltip}
          aria-label={t.list.settingsTooltip}
          onClick={onOpenSettings}
        >
          ⚙️
        </button>
      </header>
      {body()}
    </div>
  );
}
