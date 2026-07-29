import { useEffect, useState } from 'preact/hooks';
import type { Broadcast, DetectedVideo, JobState, Summary, Theme } from '@/types';
import type { Locale } from '@/i18n';
import { detectDefaultLocale, getCatalog } from '@/i18n';
import { I18nContext } from '@/i18n/context';
import { getSettings } from '@/storage';
import { applyTheme } from './theme';
import { listVideos, requestSummary, requestBatch, requestRegenerate } from './messaging';
import { VideoList } from './components/VideoList';
import { ResultView } from './components/ResultView';
import { SettingsView } from './components/SettingsView';
import { HistoryView } from './components/HistoryView';
import { Onboarding } from './components/Onboarding';

/**
 * Popup root (F2).
 *
 * The video list is a live dashboard: every video on the page shows its status
 * (idle · running · done) and its result is one click away — so multiple videos are
 * handled without losing any. Jobs run in the service worker and broadcast state.
 */
type Screen = 'list' | 'settings' | 'history';
interface Viewing {
  summary: Summary;
  /** videoId of a live session job → enables in-place length regeneration. */
  liveId?: string;
}

export function App() {
  const [locale, setLocale] = useState<Locale>(detectDefaultLocale());
  const [screen, setScreen] = useState<Screen>('list');
  const [videos, setVideos] = useState<DetectedVideo[]>([]);
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [onbInitial, setOnbInitial] = useState<{
    uiLanguage: Locale;
    outputLanguage: Locale;
    theme: Theme;
  }>({ uiLanguage: 'en', outputLanguage: 'en', theme: 'system' });

  useEffect(() => {
    void getSettings().then((s) => {
      setLocale(s.uiLanguage);
      applyTheme(s.theme);
      setOnboarded(s.onboarded);
      setOnbInitial({
        uiLanguage: s.uiLanguage,
        outputLanguage: s.outputLanguage,
        theme: s.theme,
      });
    });
    void listVideos().then(setVideos);

    const onMessage = (msg: Broadcast) => {
      if (msg.type !== 'JOB_STATE' || !('videoId' in msg.state)) return;
      const state = msg.state;
      setJobs((prev) => ({ ...prev, [state.videoId]: state }));
      if (state.phase !== 'running') setRegenerating(false);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const summarize = (video: DetectedVideo) => {
    setJobs((p) => ({ ...p, [video.id]: { phase: 'running', videoId: video.id, steps: [] } }));
    void requestSummary(video);
  };

  const summarizeAll = (chosen: DetectedVideo[]) => {
    setJobs((p) => {
      const next = { ...p };
      for (const v of chosen) next[v.id] = { phase: 'running', videoId: v.id, steps: [] };
      return next;
    });
    void requestBatch(chosen);
  };

  const openLive = (videoId: string) => {
    const st = jobs[videoId];
    if (st?.phase === 'done') setViewing({ summary: st.summary, liveId: videoId });
  };

  // Keep the open result in sync with regeneration (new summary arrives via jobs).
  const shown = viewing
    ? viewing.liveId && jobs[viewing.liveId]?.phase === 'done'
      ? (jobs[viewing.liveId] as { summary: Summary }).summary
      : viewing.summary
    : null;

  const content = () => {
    if (onboarded === null) return <div class="screen" />; // brief settings load
    if (!onboarded) {
      return (
        <Onboarding
          initial={onbInitial}
          onLocaleChange={setLocale}
          onFinish={() => setOnboarded(true)}
        />
      );
    }
    if (shown && viewing) {
      const cat = getCatalog(locale);
      return (
        <ResultView
          summary={shown}
          onBack={() => setViewing(null)}
          backLabel={viewing.liveId ? cat.nav.videos : cat.history.heading}
          regenerating={regenerating}
          onChangeLength={
            viewing.liveId
              ? (level) => {
                  setRegenerating(true);
                  void requestRegenerate(shown.videoId, level);
                }
              : undefined
          }
        />
      );
    }
    if (screen === 'settings') {
      return <SettingsView onClose={() => setScreen('list')} onLocaleChange={setLocale} />;
    }
    if (screen === 'history') {
      return (
        <HistoryView
          onOpen={(summary) => setViewing({ summary })}
          onClose={() => setScreen('list')}
        />
      );
    }
    return (
      <VideoList
        videos={videos}
        jobs={jobs}
        onSummarize={summarize}
        onSummarizeAll={summarizeAll}
        onView={openLive}
        onOpenSettings={() => setScreen('settings')}
        onOpenHistory={() => setScreen('history')}
      />
    );
  };

  return <I18nContext.Provider value={getCatalog(locale)}>{content()}</I18nContext.Provider>;
}
