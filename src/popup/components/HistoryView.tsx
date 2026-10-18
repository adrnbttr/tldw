import { useEffect, useState } from 'preact/hooks';
import type { Summary } from '@/types';
import type { HistoryEntry } from '@/storage';
import { deleteHistoryEntry, getHistoryEntries } from '@/storage';
import { isoDate } from '@/shared/format';
import { useI18n } from '@/i18n/context';
import { providerLabel } from '../provider-label';
import { Breadcrumb } from './Breadcrumb';

interface Props {
  onOpen: (summary: Summary) => void;
  onClose: () => void;
}

/** History browser (F9) — reopen a past summary without reprocessing the video, or delete it. */
export function HistoryView({ onOpen, onClose }: Props) {
  const t = useI18n();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void getHistoryEntries().then((h) => {
      setEntries(h);
      setLoaded(true);
    });
  }, []);

  const remove = (key: string) => {
    void deleteHistoryEntry(key)
      .then(() => setEntries((prev) => prev.filter((e) => e.key !== key)))
      .catch(() => {});
  };

  return (
    <div class="screen">
      <header class="topbar">
        <Breadcrumb rootLabel={t.nav.videos} current={t.history.heading} onRoot={onClose} />
      </header>

      {loaded && entries.length === 0 ? (
        <p class="empty">{t.history.empty}</p>
      ) : (
        <ul class="video-list">
          {entries.map(({ key, summary: s }) => (
            <li key={key} class="video-item history-item">
              <button class="history-row" onClick={() => onOpen(s)}>
                <div class="video-meta">
                  <span class={`badge badge-${s.provider}`}>
                    {providerLabel(s.provider, t.list.videoLabel)}
                  </span>
                  <span class="video-title">{s.title}</span>
                </div>
                <div class="video-sub">
                  <span>{isoDate(new Date(s.createdAt))}</span>
                  <span>{s.durationLabel}</span>
                </div>
              </button>
              <button
                class="secondary small danger history-delete"
                aria-label={t.history.deleteLabel(s.title)}
                title={t.history.deleteLabel(s.title)}
                onClick={() => remove(key)}
              >
                {t.history.delete}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
