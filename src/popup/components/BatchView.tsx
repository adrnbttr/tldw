import type { BatchState } from '@/types';
import { downloadBatchMarkdown } from '../export';

interface Props {
  state: BatchState;
  onBack: () => void;
}

/** Batch processing view (F8): live progress, then aggregated results + export. */
export function BatchView({ state, onBack }: Props) {
  return (
    <div class="screen">
      <header class="topbar">
        <button class="link" onClick={onBack}>
          ← Retour
        </button>
        <h1>Traitement par lot</h1>
      </header>

      {state.phase === 'running' && (
        <>
          <p class="method">
            {state.completed} / {state.total} traitées
          </p>
          <div class="progress-track">
            <div
              class="progress-fill"
              style={{ width: `${(state.completed / state.total) * 100}%` }}
            />
          </div>
          {state.currentTitle && <p class="current">En cours : {state.currentTitle}</p>}
        </>
      )}

      {state.phase === 'done' && (
        <>
          <ul class="batch-results">
            {state.results.map((r) => (
              <li key={r.videoId} class={`batch-row ${r.ok ? 'ok' : 'ko'}`}>
                <span class="batch-icon">{r.ok ? '✓' : '✗'}</span>
                <span class="video-title">{r.title}</span>
                {!r.ok && r.message && <span class="batch-error">{r.message}</span>}
              </li>
            ))}
          </ul>

          {state.summaries.length > 0 && (
            <button class="primary" onClick={() => downloadBatchMarkdown(state.summaries)}>
              Télécharger tout ({state.summaries.length}) en un fichier .md
            </button>
          )}
        </>
      )}
    </div>
  );
}
