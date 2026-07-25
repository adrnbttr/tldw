import { useState } from 'preact/hooks';
import type { DetectedVideo } from '@/types';
import { formatDuration } from '@/shared/format';
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

const treatable = (v: DetectedVideo) => v.provider === 'youtube' || v.provider === 'vimeo';

export function VideoList({ videos, onSummarize, onBatch, onOpenSettings, onOpenHistory }: Props) {
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
        <button class="icon-btn" title="Historique" onClick={onOpenHistory}>
          🕘
        </button>
        <button class="icon-btn" title="Paramètres" onClick={onOpenSettings}>
          ⚙️
        </button>
      </header>

      {videos.length === 0 ? (
        <p class="empty">
          Aucune vidéo trouvée sur cette page.
          <br />
          Lancez la lecture puis rouvrez ce menu.
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
                  <span class="video-title">{video.title ?? 'Vidéo sans titre'}</span>
                </div>
                <div class="video-sub">
                  {video.duration != null && <span>{formatDuration(video.duration)}</span>}
                  {!treatable(video) && <span class="warn">non traitable</span>}
                </div>
                <button class="primary" disabled={!treatable(video)} onClick={() => start(video)}>
                  Résumer
                </button>
              </li>
            ))}
          </ul>

          {selected.size > 0 && (
            <button class="primary batch-btn" onClick={runBatch}>
              Résumer la sélection ({selected.size})
            </button>
          )}
        </>
      )}
    </div>
  );
}
