import type { BatchState } from '@/types';
import { useI18n } from '@/i18n/context';
import { downloadBatchMarkdown } from '../export';

interface Props {
  state: BatchState;
  onBack: () => void;
}

/** Batch processing view (F8): live progress, then aggregated results + export. */
export function BatchView({ state, onBack }: Props) {
  const t = useI18n();

  return (
    <div class="screen">
      <header class="topbar">
        <button class="link" onClick={onBack}>
          {t.batch.back}
        </button>
        <h1>{t.batch.heading}</h1>
      </header>

      {state.phase === 'running' && (
        <>
          <p class="method">{t.batch.progress(state.completed, state.total)}</p>
          <div class="progress-track">
            <div
              class="progress-fill"
              style={{ width: `${(state.completed / state.total) * 100}%` }}
            />
          </div>
          {state.currentTitle && <p class="current">{t.batch.current(state.currentTitle)}</p>}
        </>
      )}

      {state.phase === 'done' && (
        <>
          <ul class="batch-results">
            {state.results.map((r) => (
              <li key={r.videoId} class={`batch-row ${r.ok ? 'ok' : 'ko'}`}>
                <span class="batch-icon">{r.ok ? '✓' : '✗'}</span>
                <span class="video-title">{r.title}</span>
                {!r.ok && r.code && <span class="batch-error">{t.errors[r.code]}</span>}
              </li>
            ))}
          </ul>

          {state.summaries.length > 0 && (
            <button class="primary" onClick={() => downloadBatchMarkdown(state.summaries)}>
              {t.batch.downloadAll(state.summaries.length)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
