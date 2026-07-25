import { useEffect, useState } from 'preact/hooks';
import type { Summary } from '@/types';
import { getHistory } from '@/storage';
import { isoDate } from '@/shared/format';
import { useI18n } from '@/i18n/context';

interface Props {
  onOpen: (summary: Summary) => void;
  onClose: () => void;
}

/** History browser (F9) — reopen a past summary without reprocessing the video. */
export function HistoryView({ onOpen, onClose }: Props) {
  const t = useI18n();
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
          {t.history.back}
        </button>
        <h1>{t.history.heading}</h1>
      </header>

      {loaded && summaries.length === 0 ? (
        <p class="empty">{t.history.empty}</p>
      ) : (
        <ul class="video-list">
          {summaries.map((s) => (
            <li key={`${s.videoId}-${s.createdAt}`} class="video-item history-item">
              <button class="history-row" onClick={() => onOpen(s)}>
                <div class="video-meta">
                  <span class={`badge badge-${s.provider}`}>
                    {s.provider === 'youtube'
                      ? 'YouTube'
                      : s.provider === 'vimeo'
                        ? 'Vimeo'
                        : t.list.videoLabel}
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
