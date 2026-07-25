import { useEffect, useState } from 'preact/hooks';
import type { Broadcast, BatchState, DetectedVideo, JobState, Summary } from '@/types';
import { listVideos, requestBatch, getBatchState, getActiveJob } from './messaging';
import { VideoList } from './components/VideoList';
import { ProcessingView } from './components/ProcessingView';
import { ResultView } from './components/ResultView';
import { SettingsView } from './components/SettingsView';
import { HistoryView } from './components/HistoryView';
import { BatchView } from './components/BatchView';

/**
 * Popup root (F2).
 *
 * Views: list · processing · result · settings · history · batch. Job and batch
 * state are owned by the service worker; the popup subscribes to broadcasts and
 * restores state on open, so work keeps running while the popup is closed.
 */
type Screen = 'list' | 'settings' | 'history' | 'batch';

export function App() {
  const [screen, setScreen] = useState<Screen>('list');
  const [videos, setVideos] = useState<DetectedVideo[]>([]);
  const [active, setActive] = useState<DetectedVideo | null>(null);
  const [jobState, setJobState] = useState<JobState>({ phase: 'idle' });
  const [batchState, setBatchState] = useState<BatchState>({ phase: 'idle' });
  const [historySummary, setHistorySummary] = useState<Summary | null>(null);

  useEffect(() => {
    void listVideos().then(setVideos);

    // Restore in-flight work after the popup was closed and reopened (F2).
    void (async () => {
      const batch = await getBatchState();
      if (batch.phase === 'running') {
        setBatchState(batch);
        setScreen('batch');
        return;
      }
      const job = await getActiveJob();
      if (job && job.state.phase === 'running') {
        setActive(job.video);
        setJobState(job.state);
      }
    })();

    const onMessage = (msg: Broadcast) => {
      if (msg.type === 'JOB_STATE') setJobState(msg.state);
      if (msg.type === 'BATCH_STATE') setBatchState(msg.state);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const startFor = (video: DetectedVideo) => {
    setActive(video);
    setJobState({ phase: 'running', videoId: video.id, steps: [] });
  };

  const startBatch = (chosen: DetectedVideo[]) => {
    void requestBatch(chosen);
    void getBatchState().then(setBatchState);
    setScreen('batch');
  };

  const backToList = () => {
    setActive(null);
    setJobState({ phase: 'idle' });
    setScreen('list');
    void listVideos().then(setVideos);
  };

  if (screen === 'settings') {
    return <SettingsView onClose={() => setScreen('list')} />;
  }

  if (screen === 'history') {
    if (historySummary) {
      return <ResultView summary={historySummary} onBack={() => setHistorySummary(null)} />;
    }
    return <HistoryView onOpen={setHistorySummary} onClose={() => setScreen('list')} />;
  }

  if (screen === 'batch') {
    return <BatchView state={batchState} onBack={backToList} />;
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
      onBatch={startBatch}
      onOpenSettings={() => setScreen('settings')}
      onOpenHistory={() => setScreen('history')}
    />
  );
}
