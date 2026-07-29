import type { DetectedVideo, JobState, Summary } from '@/types';
import { formatDuration } from '@/shared/format';
import { useI18n } from '@/i18n/context';
import { cancel } from '../messaging';
import { downloadPdfBatch } from '../export-pdf';

interface Props {
  videos: DetectedVideo[];
  jobs: Record<string, JobState>;
  onSummarize: (video: DetectedVideo) => void;
  onSummarizeAll: (videos: DetectedVideo[]) => void;
  onView: (videoId: string) => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

const treatable = (v: DetectedVideo) => v.provider !== 'unknown';

function providerLabel(p: DetectedVideo['provider'], videoLabel: string): string {
  if (p === 'youtube') return 'YouTube';
  if (p === 'vimeo') return 'Vimeo';
  return videoLabel;
}

export function VideoList({
  videos,
  jobs,
  onSummarize,
  onSummarizeAll,
  onView,
  onOpenSettings,
  onOpenHistory,
}: Props) {
  const t = useI18n();

  const states = videos.map((v) => jobs[v.id]);
  const doneSummaries: Summary[] = states
    .filter((s): s is Extract<JobState, { phase: 'done' }> => s?.phase === 'done')
    .map((s) => s.summary);
  const doneCount = doneSummaries.length;
  const runningCount = states.filter((s) => s?.phase === 'running').length;

  const pending = videos.filter((v) => treatable(v) && !jobs[v.id]);

  // Global batch progress — shown only while several videos are processing.
  const batchTotal = doneCount + runningCount;
  const showBatchBar = runningCount > 0 && batchTotal >= 2;

  return (
    <div class="screen">
      <header class="topbar">
        <h1>tldw</h1>
        <button class="icon-btn" title={t.list.historyTooltip} onClick={onOpenHistory}>
          🕘
        </button>
        <button class="icon-btn" title={t.list.settingsTooltip} onClick={onOpenSettings}>
          ⚙️
        </button>
      </header>

      {videos.length === 0 ? (
        <p class="empty">
          {t.list.emptyTitle}
          <br />
          {t.list.emptyHint}
        </p>
      ) : (
        <>
          <p class="overview">{t.list.overview(videos.length, doneCount)}</p>

          {showBatchBar && (
            <div class="batch-progress">
              <div class="progress-track">
                <div
                  class="progress-fill"
                  style={{ width: `${(doneCount / batchTotal) * 100}%` }}
                />
              </div>
              <span class="batch-count">{t.list.batchProgress(doneCount, batchTotal)}</span>
            </div>
          )}

          <ul class="video-list">
            {videos.map((video) => {
              const job = jobs[video.id];
              const activeStep =
                job?.phase === 'running' ? job.steps.find((s) => s.status === 'active') : undefined;

              const isDone = job?.phase === 'done';
              return (
                <li key={video.id} class={`video-item ${isDone ? 'done' : ''}`}>
                  <div class="video-meta">
                    <span class={`badge badge-${video.provider}`}>
                      {providerLabel(video.provider, t.list.videoLabel)}
                    </span>
                    <span class="video-title">{video.title ?? t.list.noTitle}</span>
                    {isDone && (
                      <span class="done-check" title="✓">
                        ✓
                      </span>
                    )}
                  </div>
                  <div class="video-sub">
                    {video.duration != null && <span>{formatDuration(video.duration)}</span>}
                    {!treatable(video) && <span class="warn">{t.list.untreatable}</span>}
                  </div>

                  {job?.phase === 'running' ? (
                    <div class="row-running">
                      <span class="spinner">⟳</span>
                      <span class="running-label">
                        {activeStep ? t.processing.steps[activeStep.step] : t.list.summarize}
                        {activeStep?.detail ? ` · ${activeStep.detail}` : ''}
                      </span>
                      <button class="cancel-link" onClick={() => void cancel(video.id)}>
                        {t.processing.cancel}
                      </button>
                    </div>
                  ) : job?.phase === 'done' ? (
                    <button class="primary" onClick={() => onView(video.id)}>
                      {t.list.view}
                    </button>
                  ) : job?.phase === 'error' ? (
                    <div class="row-error">
                      <span class="err">{t.errors[job.code]}</span>
                      <button class="secondary" onClick={() => onSummarize(video)}>
                        {t.list.summarize}
                      </button>
                    </div>
                  ) : (
                    <button
                      class="primary"
                      disabled={!treatable(video)}
                      onClick={() => onSummarize(video)}
                    >
                      {t.list.summarize}
                    </button>
                  )}
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
            <button class="secondary batch-btn" onClick={() => downloadPdfBatch(doneSummaries)}>
              {t.batch.downloadAll(doneSummaries.length)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
