import { useState } from 'preact/hooks';
import type { DetectedVideo } from '@/types';
import { formatDuration } from '@/shared/format';
import { useI18n } from '@/i18n/context';
import { requestSummary } from '../messaging';

interface Props {
  videos: DetectedVideo[];
  onSummarize: (video: DetectedVideo) => void;
  onBatch: (videos: DetectedVideo[]) => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

const PROVIDER_LABEL: Record<DetectedVideo['provider'], string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  native: 'Vidéo',
  unknown: 'Inconnu',
};

const treatable = (v: DetectedVideo) => v.provider !== 'unknown';

export function VideoList({ videos, onSummarize, onBatch, onOpenSettings, onOpenHistory }: Props) {
  const t = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const start = (video: DetectedVideo) => {
    void requestSummary(video);
    onSummarize(video);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBatch = () => {
    const chosen = videos.filter((v) => selected.has(v.id) && treatable(v));
    if (chosen.length > 0) onBatch(chosen);
  };

  const selectableCount = videos.filter(treatable).length;

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
          <ul class="video-list">
            {videos.map((video) => (
              <li key={video.id} class="video-item">
                <div class="video-meta">
                  {selectableCount > 1 && treatable(video) && (
                    <input
                      type="checkbox"
                      checked={selected.has(video.id)}
                      onChange={() => toggle(video.id)}
                    />
                  )}
                  <span class={`badge badge-${video.provider}`}>
                    {PROVIDER_LABEL[video.provider]}
                  </span>
                  <span class="video-title">{video.title ?? t.list.noTitle}</span>
                </div>
                <div class="video-sub">
                  {video.duration != null && <span>{formatDuration(video.duration)}</span>}
                  {!treatable(video) && <span class="warn">{t.list.untreatable}</span>}
                </div>
                <button class="primary" disabled={!treatable(video)} onClick={() => start(video)}>
                  {t.list.summarize}
                </button>
              </li>
            ))}
          </ul>

          {selected.size > 0 && (
            <button class="primary batch-btn" onClick={runBatch}>
              {t.list.summarizeSelection(selected.size)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
