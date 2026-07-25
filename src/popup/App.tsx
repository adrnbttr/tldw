import { useEffect, useState } from 'preact/hooks';
import type { Broadcast, DetectedVideo, JobState } from '@/types';
import { listVideos } from './messaging';
import { VideoList } from './components/VideoList';
import { ProcessingView } from './components/ProcessingView';
import { ResultView } from './components/ResultView';
import { SettingsView } from './components/SettingsView';

/**
 * Popup root (F2).
 *
 * Views: list · processing · result · settings. Job state is owned by the service
 * worker; the popup subscribes to broadcasts and restores state on open, so a job
 * keeps running while the popup is closed.
 */
type Screen = 'list' | 'settings';

export function App() {
  const [screen, setScreen] = useState<Screen>('list');
  const [videos, setVideos] = useState<DetectedVideo[]>([]);
  const [active, setActive] = useState<DetectedVideo | null>(null);
  const [jobState, setJobState] = useState<JobState>({ phase: 'idle' });

  useEffect(() => {
    void listVideos().then(setVideos);

    const onMessage = (msg: Broadcast) => {
      if (msg.type === 'JOB_STATE') setJobState(msg.state);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const startFor = (video: DetectedVideo) => {
    setActive(video);
    setJobState({ phase: 'running', videoId: video.id, steps: [] });
  };

  const backToList = () => {
    setActive(null);
    setJobState({ phase: 'idle' });
    void listVideos().then(setVideos);
  };

  if (screen === 'settings') {
    return <SettingsView onClose={() => setScreen('list')} />;
  }

  if (active && jobState.phase === 'done') {
    return <ResultView summary={jobState.summary} onBack={backToList} />;
  }
  if (active && (jobState.phase === 'running' || jobState.phase === 'error')) {
    return <ProcessingView video={active} state={jobState} onBack={backToList} />;
  }

  return (
    <VideoList
      videos={videos}
      onSummarize={startFor}
      onOpenSettings={() => setScreen('settings')}
    />
  );
}
