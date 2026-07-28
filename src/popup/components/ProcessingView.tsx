import type { DetectedVideo, JobState, JobStepStatus } from '@/types';
import { useI18n } from '@/i18n/context';
import { cancel } from '../messaging';

interface Props {
  video: DetectedVideo;
  state: JobState;
  onBack: () => void;
}

const STATUS_ICON: Record<JobStepStatus, string> = {
  pending: '○',
  active: '⟳',
  done: '✓',
  skipped: '–',
  failed: '✗',
};

export function ProcessingView({ video, state, onBack }: Props) {
  const t = useI18n();
  const steps = state.phase === 'running' ? state.steps : [];

  return (
    <div class="screen">
      <header class="topbar">
        <button class="link" onClick={onBack}>
          {t.processing.back}
        </button>
        <h1>{video.title ?? t.processing.steps.summarize}</h1>
      </header>

      {state.phase === 'error' ? (
        <div class="error-box">
          <p class="error-title">{t.processing.failedTitle}</p>
          <p>{t.errors[state.code]}</p>
          {state.detail && <p class="error-detail">{state.detail}</p>}
          <button class="primary" onClick={onBack}>
            {t.processing.backToList}
          </button>
        </div>
      ) : (
        <>
          <ul class="steps">
            {steps.map((s) => (
              <li key={s.step} class={`step step-${s.status}`}>
                <span class="step-icon">{STATUS_ICON[s.status]}</span>
                <span class="step-body">
                  <span class="step-label">{t.processing.steps[s.step]}</span>
                  {s.detail && <span class="step-detail">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          <button class="link danger" onClick={() => void cancel(video.id)}>
            {t.processing.cancel}
          </button>
        </>
      )}
    </div>
  );
}
