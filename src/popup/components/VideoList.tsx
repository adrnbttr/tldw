import type { DetectedVideo } from '@/types';
import { formatDuration } from '@/shared/format';
import { requestSummary } from '../messaging';

interface Props {
  videos: DetectedVideo[];
  onSummarize: (video: DetectedVideo) => void;
  onOpenSettings: () => void;
}

const PROVIDER_LABEL: Record<DetectedVideo['provider'], string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  native: 'Vidéo',
  unknown: 'Inconnu',
};

export function VideoList({ videos, onSummarize, onOpenSettings }: Props) {
  const start = (video: DetectedVideo) => {
    void requestSummary(video);
    onSummarize(video);
  };

  const treatable = (v: DetectedVideo) => v.provider === 'youtube' || v.provider === 'vimeo';

  return (
    <div class="screen">
      <header class="topbar">
        <h1>tldw</h1>
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
        <ul class="video-list">
          {videos.map((video) => (
            <li key={video.id} class="video-item">
              <div class="video-meta">
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
      )}
    </div>
  );
}
