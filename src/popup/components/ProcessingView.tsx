import type { DetectedVideo, JobState, JobStep, JobStepStatus } from '@/types';
import { cancel } from '../messaging';

interface Props {
  video: DetectedVideo;
  state: JobState;
  onBack: () => void;
}

const STEP_LABEL: Record<JobStep, string> = {
  detect: 'Détection',
  captions: 'Recherche des sous-titres',
  audio_capture: 'Capture du flux média',
  transcription: 'Transcription audio',
  summarize: 'Génération du résumé',
};

const STATUS_ICON: Record<JobStepStatus, string> = {
  pending: '○',
  active: '⟳',
  done: '✓',
  skipped: '–',
  failed: '✗',
};

export function ProcessingView({ video, state, onBack }: Props) {
  const steps = state.phase === 'running' ? state.steps : [];

  return (
    <div class="screen">
      <header class="topbar">
        <button class="link" onClick={onBack}>
          ← Retour
        </button>
        <h1>{video.title ?? 'Traitement'}</h1>
      </header>

      {state.phase === 'error' ? (
        <div class="error-box">
          <p class="error-title">Échec</p>
          <p>{state.message}</p>
          <button class="primary" onClick={onBack}>
            Retour à la liste
          </button>
        </div>
      ) : (
        <>
          <ul class="steps">
            {steps.map((s) => (
              <li key={s.step} class={`step step-${s.status}`}>
                <span class="step-icon">{STATUS_ICON[s.status]}</span>
                <span class="step-label">{STEP_LABEL[s.step]}</span>
                {s.detail && <span class="step-detail">{s.detail}</span>}
              </li>
            ))}
          </ul>
          <button class="link danger" onClick={() => void cancel(video.id)}>
            Annuler
          </button>
        </>
      )}
    </div>
  );
}
