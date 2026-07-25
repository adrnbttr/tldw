import { useEffect, useState } from 'preact/hooks';
import type { Summary } from '@/types';
import { getHistory } from '@/storage';
import { isoDate } from '@/shared/format';

interface Props {
  onOpen: (summary: Summary) => void;
  onClose: () => void;
}

const PROVIDER_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  native: 'Vidéo',
};

/** History browser (F9) — reopen a past summary without reprocessing the video. */
export function HistoryView({ onOpen, onClose }: Props) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getHistory().then((h) => {
      setSummaries(h);
      setLoaded(true);
    });
  }, []);

  return (
    <div class="screen">
      <header class="topbar">
        <button class="link" onClick={onClose}>
          ← Retour
        </button>
        <h1>Historique</h1>
      </header>

      {loaded && summaries.length === 0 ? (
        <p class="empty">Aucun résumé enregistré pour l'instant.</p>
      ) : (
        <ul class="video-list">
          {summaries.map((s) => (
            <li key={`${s.videoId}-${s.createdAt}`} class="video-item history-item">
              <button class="history-row" onClick={() => onOpen(s)}>
                <div class="video-meta">
                  <span class={`badge badge-${s.provider}`}>
                    {PROVIDER_LABEL[s.provider] ?? s.provider}
                  </span>
                  <span class="video-title">{s.title}</span>
                </div>
                <div class="video-sub">
                  <span>{isoDate(new Date(s.createdAt))}</span>
                  <span>{s.durationLabel}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
