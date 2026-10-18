import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Broadcast, DetectedVideo, DownloadFormat, JobState, Summary, Theme } from '@/types';
import type { Locale } from '@/i18n';
import { detectDefaultLocale, getCatalog } from '@/i18n';
import { I18nContext } from '@/i18n/context';
import { getSettings } from '@/storage';
import { applyTheme } from './theme';
import { getJobs, listVideos, rescanVideos, requestSummary, requestBatch } from './messaging';
import { matchJobs } from './job-match';
import { stampFailedAt } from './retry';
import { batchFinished, batchProgress, loadBatchKeys, saveBatchKeys } from './batch';
import { videoKey } from '@/shared/video-key';
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
  // False until the first LIST_VIDEOS answer: the list shows a skeleton, not "no video".
  const [videosLoaded, setVideosLoaded] = useState(false);
  // Raw worker jobs by job id, and each job's stable video key: the list
  // matches them to its videos (`matchJobs`), whatever local id they carry.
  const [jobsById, setJobsById] = useState<Record<string, JobState>>({});
  const [keysById, setKeysById] = useState<Record<string, string>>({});
  const jobs = useMemo(() => matchJobs(videos, jobsById, keysById), [videos, jobsById, keysById]);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [rescanning, setRescanning] = useState(false);
  // Stable keys of the videos sent by "Summarize all" (see batch.ts).
  const [batchKeys, setBatchKeys] = useState<string[]>([]);
  const batch = useMemo(() => batchProgress(videos, jobs, batchKeys), [videos, jobs, batchKeys]);
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>('pdf');
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [onbInitial, setOnbInitial] = useState<{
    uiLanguage: Locale;
    outputLanguage: Locale;
    theme: Theme;
  }>({ uiLanguage: 'en', outputLanguage: 'en', theme: 'system' });

  // <html lang> follows the UI language: screen readers and `hyphens: auto` rely on it.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // A finished batch is forgotten, so later single runs never show as one.
  useEffect(() => {
    if (batchFinished(videos, jobs, batchKeys)) {
      setBatchKeys([]);
      void saveBatchKeys([]).catch(() => {});
    }
  }, [videos, jobs, batchKeys]);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setLocale(s.uiLanguage);
        applyTheme(s.theme);
        setDownloadFormat(s.downloadFormat);
        setOnboarded(s.onboarded);
        setOnbInitial({
          uiLanguage: s.uiLanguage,
          outputLanguage: s.outputLanguage,
          theme: s.theme,
        });
      })
      // Unreadable settings: show the wizard rather than a blank popup.
      .catch(() => setOnboarded(false));
    listVideos()
      .then(setVideos)
      .catch(() => setVideos([]))
      .finally(() => setVideosLoaded(true));
    // Jobs already known to the worker — running, queued, or INTERRUPTED by a
    // worker restart — so reopening the popup shows them on their videos.
    loadJobs(false).catch(() => {});
    loadBatchKeys()
      .then(setBatchKeys)
      .catch(() => {});

    const onMessage = (msg: Broadcast) => {
      if (msg.type !== 'JOB_STATE' || !('videoId' in msg.state)) return;
      const state = stampFailedAt(msg.state, Date.now());
      if (!('videoId' in state)) return;
      setJobsById((prev) => ({ ...prev, [state.videoId]: state }));
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  /**
   * Merges the worker's keyed jobs. `authoritative`: the worker's states win
   * over what the popup holds (right after it registered new jobs); otherwise
   * live broadcasts already received win.
   */
  const loadJobs = async (authoritative: boolean) => {
    const known = await getJobs();
    const states: Record<string, JobState> = {};
    const keys: Record<string, string> = {};
    const now = Date.now();
    for (const { key, state } of known) {
      if (!('videoId' in state)) continue;
      states[state.videoId] = stampFailedAt(state, now);
      keys[state.videoId] = key;
    }
    setJobsById((prev) => (authoritative ? { ...prev, ...states } : { ...states, ...prev }));
    setKeysById((prev) => (authoritative ? { ...prev, ...keys } : { ...keys, ...prev }));
  };

  /** Records `jobId` as the job of `key`, superseding older jobs of that video. */
  const track = (jobId: string, key: string, state: JobState) => {
    setKeysById((prev) => {
      const next: Record<string, string> = {};
      for (const [id, k] of Object.entries(prev)) if (k !== key) next[id] = k;
      next[jobId] = key;
      return next;
    });
    setJobsById((prev) => ({ ...prev, [jobId]: state }));
  };

  /** Shows a retryable UNKNOWN error on `videoId` (the worker did not answer). */
  const failLocally = (videoId: string) =>
    setJobsById((prev) => ({
      ...prev,
      [videoId]: {
        phase: 'error',
        videoId,
        code: 'UNKNOWN',
        message: getCatalog(locale).errors.UNKNOWN,
      },
    }));

  /** `force`: regenerate — bypass the saved summary (the user asked for a new one). */
  const summarize = (video: DetectedVideo, force = false) => {
    // Already running or queued: the row shows its progress, nothing to start.
    if (jobs[video.id]?.phase === 'running') return;
    const key = videoKey(video);
    track(video.id, key, { phase: 'running', videoId: video.id, steps: [] });
    void requestSummary(video, { force })
      // Transport failure (worker unreachable): same as no answer.
      .catch(() => null)
      .then((state) => {
        // No answer from the worker: the optimistic `running` would spin
        // forever — show a retryable error instead.
        if (!state) {
          failLocally(video.id);
          return;
        }
        // Joined an existing job (same video under another local id): follow it.
        if ('videoId' in state && state.videoId !== video.id) {
          setJobsById((prev) => {
            const next = { ...prev };
            delete next[video.id];
            return next;
          });
          track(state.videoId, key, state);
        }
      });
  };

  const summarizeAll = (chosen: DetectedVideo[]) => {
    const fresh = chosen.filter((v) => jobs[v.id]?.phase !== 'running');
    if (fresh.length === 0) return;
    // Remember the batch (keys survive the popup closing) for its progress bar.
    const keys = [...new Set([...batchKeys, ...fresh.map(videoKey)])];
    setBatchKeys(keys);
    void saveBatchKeys(keys).catch(() => {});
    // The worker registers every item (queued) before it answers: its own
    // states — not an optimistic guess — then show on the rows.
    requestBatch(fresh)
      .then(() => loadJobs(true))
      .catch(() => fresh.forEach((v) => failLocally(v.id)));
  };

  const openLive = (videoId: string) => {
    const st = jobs[videoId];
    if (st?.phase === 'done') setViewing({ summary: st.summary, liveId: videoId });
  };

  const rescan = () => {
    setRescanning(true);
    rescanVideos()
      .then(setVideos)
      // Keep the current list when the rescan fails.
      .catch(() => {})
      .finally(() => {
        setRescanning(false);
        setVideosLoaded(true);
      });
  };

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
    if (viewing) {
      const cat = getCatalog(locale);
      // A live summary of a video still on the page can be regenerated.
      const liveVideo = viewing.liveId ? videos.find((v) => v.id === viewing.liveId) : undefined;
      return (
        <ResultView
          summary={viewing.summary}
          onRegenerate={
            liveVideo
              ? () => {
                  setViewing(null);
                  summarize(liveVideo, true);
                }
              : undefined
          }
          onBack={() => setViewing(null)}
          backLabel={viewing.liveId ? cat.nav.videos : cat.history.heading}
          primaryFormat={downloadFormat}
        />
      );
    }
    if (screen === 'settings') {
      return (
        <SettingsView
          onClose={() => {
            setScreen('list');
            // Pick up a changed default export format for the result view.
            void getSettings().then((s) => setDownloadFormat(s.downloadFormat));
          }}
          onLocaleChange={setLocale}
          onReplayOnboarding={() => {
            void getSettings().then((s) => {
              setOnbInitial({
                uiLanguage: s.uiLanguage,
                outputLanguage: s.outputLanguage,
                theme: s.theme,
              });
              setScreen('list');
              setOnboarded(false);
            });
          }}
        />
      );
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
        loaded={videosLoaded}
        jobs={jobs}
        batch={batch}
        rescanning={rescanning}
        onSummarize={(video) => summarize(video)}
        onRegenerate={(video) => summarize(video, true)}
        onSummarizeAll={summarizeAll}
        onView={openLive}
        onRescan={rescan}
        onOpenSettings={() => setScreen('settings')}
        onOpenHistory={() => setScreen('history')}
      />
    );
  };

  return <I18nContext.Provider value={getCatalog(locale)}>{content()}</I18nContext.Provider>;
}
