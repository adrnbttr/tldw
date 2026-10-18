import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, TldwError } from '@/types';
import type { DetectedVideo, JobState, Summary, Transcript } from '@/types';
import { findCachedSummary, findSummaryByKey, getSettings, saveSummary } from '@/storage';
import type { Adapter } from '@/adapters';
import { selectAdapter } from '@/adapters';
import { summarize } from '@/summarizer';
import { audioTranscriber } from '@/transcription';
import { holdKeepalive } from './keepalive';
import { log } from './log';
import type { JobStore, StoredSnapshot } from './job-store';
import {
  cancelJob,
  getJobState,
  getKeyedJobs,
  restoreJobs,
  runBatch,
  runJob,
  runningJobIdFor,
} from './orchestrator';

/**
 * Regression tests of the job lifecycle: cancellation, batch registration,
 * watchdogs, write throttling, keepalive release and snapshot size. Ported
 * from independent reviewer reproductions (each failed on the previous build).
 */
vi.mock('@/storage', () => ({
  getSettings: vi.fn(),
  findCachedSummary: vi.fn(),
  findSummaryByKey: vi.fn(),
  saveSummary: vi.fn(),
}));
vi.mock('@/adapters', () => ({ selectAdapter: vi.fn() }));
vi.mock('@/summarizer', () => ({ summarize: vi.fn(), summarizeYouTubeVideo: vi.fn() }));
vi.mock('@/transcription', () => ({ audioTranscriber: { transcribe: vi.fn() } }));
vi.mock('./log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const releases: Array<ReturnType<typeof vi.fn>> = [];
vi.mock('./keepalive', () => ({
  holdKeepalive: vi.fn(() => {
    const release = vi.fn();
    releases.push(release);
    return release;
  }),
}));

/** chrome.storage.session fake that counts (and records) writes. */
const writes: unknown[] = [];
const sessionSet = vi.fn(async (items: Record<string, unknown>) => {
  writes.push(JSON.parse(JSON.stringify(items)));
});

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  releases.length = 0;
  vi.stubGlobal('chrome', {
    storage: { session: { set: sessionSet, get: vi.fn(async () => ({})) } },
  });
  vi.mocked(getSettings).mockResolvedValue(DEFAULT_SETTINGS);
  vi.mocked(findCachedSummary).mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let seq = 0;
/** A fresh video (own id + own key) per call: the orchestrator is a singleton. */
function yt(over: Partial<DetectedVideo> = {}): DetectedVideo {
  seq++;
  return {
    id: `v${seq}`,
    provider: 'youtube',
    externalId: `ext${seq}`,
    title: `Video ${seq}`,
    duration: 60,
    iframeSrc: null,
    mediaSrc: null,
    isPlaying: false,
    ...over,
  };
}

const transcriptOf = (
  v: DetectedVideo,
  over: Partial<Transcript['metadata']> = {},
): Transcript => ({
  videoId: v.id,
  source: 'youtube_captions',
  language: 'en',
  duration: 60,
  segments: [{ start: 0, end: 1, text: 'x' }],
  fullText: 'x',
  metadata: { title: v.title, provider: v.provider, extractedAt: 'now', ...over },
});

const summaryOf = (videoId: string): Summary => ({
  videoId,
  title: videoId,
  provider: 'youtube',
  durationLabel: '1 min',
  transcriptSource: 'youtube_captions',
  createdAt: 'now',
  locale: 'en',
  detailLevel: 'standard',
  model: 'm',
  content: { tldr: '', keyPoints: [], sections: [], glossary: [], takeaways: [] },
  markdown: '# summary body',
});

function captions(extract: Adapter['extractCaptions']): Adapter {
  const adapter: Adapter = { provider: 'youtube', canHandle: () => true, extractCaptions: extract };
  vi.mocked(selectAdapter).mockReturnValue(adapter);
  return adapter;
}

/** Rejects with `err` when `signal` aborts (what a fetch(signal) does). */
const rejectOnAbort = (signal: AbortSignal | undefined, err: unknown) =>
  new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(err)));

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('cancel', () => {
  it('relaunching right after cancel starts a fresh job instead of joining the dying one', async () => {
    const v = yt({ provider: 'native', externalId: '', mediaSrc: 'https://x.test/a.mp4' });
    vi.mocked(selectAdapter).mockReturnValue(null);
    let call = 0;
    vi.mocked(audioTranscriber.transcribe).mockImplementation(async (video, _s, _p, signal) => {
      call++;
      if (call === 1) {
        // First run: stuck (e.g. inside primeAndWait), then fails late with
        // the old TIMEOUT "cancelled" error once aborted.
        await rejectOnAbort(signal, new TldwError('TIMEOUT', 'Transcription cancelled.'));
      }
      return { ...transcriptOf(video), source: 'audio_transcription' };
    });
    vi.mocked(summarize).mockImplementation(async (t) => summaryOf(t.videoId));

    const first = runJob({ ...v, id: 'cancel-a' }, vi.fn());
    await tick();
    cancelJob('cancel-a');
    expect(getJobState('cancel-a')).toMatchObject({ phase: 'error', code: 'CANCELLED' });
    expect(runningJobIdFor(v)).toBeNull();

    const handledBy = await runJob({ ...v, id: 'cancel-b' }, vi.fn());
    await first;
    expect(handledBy).toBe('cancel-b');
    expect(getJobState('cancel-b')).toMatchObject({ phase: 'done' });
  });

  it('a late result of the cancelled run never overwrites the relaunch under the same id', async () => {
    const v = yt({ provider: 'native', externalId: '', mediaSrc: 'https://x.test/late.mp4' });
    vi.mocked(selectAdapter).mockReturnValue(null);
    let finishOld!: () => void;
    let n = 0;
    // The audio fallback has its own budgets (no phase watchdog): an old run
    // that ignores its signal can come back late with a result.
    vi.mocked(audioTranscriber.transcribe).mockImplementation(async (video) => {
      n++;
      if (n === 1) await new Promise<void>((r) => (finishOld = r));
      return { ...transcriptOf(video), source: 'audio_transcription' };
    });
    let finishNew!: (s: Summary) => void;
    vi.mocked(summarize).mockImplementation(
      () => new Promise<Summary>((resolve) => (finishNew = resolve)),
    );
    const broadcastOld = vi.fn();
    const old = runJob(v, broadcastOld);
    await tick();
    cancelJob(v.id);
    const relaunch = runJob(v, vi.fn());
    await vi.waitFor(() => expect(summarize).toHaveBeenCalledOnce());
    broadcastOld.mockClear();
    finishOld();
    await old;
    expect(summarize).toHaveBeenCalledOnce();
    expect(broadcastOld).not.toHaveBeenCalled();
    expect(getJobState(v.id).phase).toBe('running');
    finishNew(summaryOf(v.id));
    await relaunch;
    expect(getJobState(v.id)).toMatchObject({ phase: 'done' });
  });

  it('cancel during the summary call is a neutral CANCELLED, not TIMEOUT', async () => {
    const v = yt();
    captions(async (video) => transcriptOf(video));
    vi.mocked(summarize).mockImplementation((_t, _s, signal) =>
      rejectOnAbort(signal, new TldwError('TIMEOUT', 'Summary request aborted.')),
    );
    const done = runJob(v, vi.fn());
    await vi.waitFor(() => expect(summarize).toHaveBeenCalled());
    cancelJob(v.id);
    await done;
    expect(getJobState(v.id)).toMatchObject({ phase: 'error', code: 'CANCELLED' });
  });

  it('cancel during the captions fetch (raw AbortError) is CANCELLED and never cascades', async () => {
    const v = yt({ provider: 'vimeo' });
    captions((_v, signal) =>
      rejectOnAbort(signal, new DOMException('The user aborted a request.', 'AbortError')),
    );
    const done = runJob(v, vi.fn());
    await tick();
    cancelJob(v.id);
    await done;
    expect(getJobState(v.id)).toMatchObject({ phase: 'error', code: 'CANCELLED' });
    expect(audioTranscriber.transcribe).not.toHaveBeenCalled();
  });

  it('an abort disguised as NO_CAPTIONS does not fall back to audio', async () => {
    const v = yt({ provider: 'vimeo' });
    captions((_v, signal) =>
      rejectOnAbort(signal, new TldwError('NO_CAPTIONS_AVAILABLE', 'Caption extraction failed.')),
    );
    const done = runJob(v, vi.fn());
    await tick();
    cancelJob(v.id);
    await done;
    expect(audioTranscriber.transcribe).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });
});

describe('batch', () => {
  it('registers every item up front: queued items are listed, cancellable, and never run once cancelled', async () => {
    const A = yt();
    const B = yt();
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const extract = vi.fn(async (v: DetectedVideo) => {
      if (v.id === A.id) await gateA;
      return transcriptOf(v);
    });
    captions(extract);
    vi.mocked(summarize).mockImplementation(async (t) => summaryOf(t.videoId));

    const batch = runBatch([A, B], vi.fn());
    const keyed = getKeyedJobs();
    expect(keyed.map((k) => k.key)).toEqual(
      expect.arrayContaining([`youtube:${A.externalId}`, `youtube:${B.externalId}`]),
    );
    expect(getJobState(B.id)).toMatchObject({
      phase: 'running',
      progress: { phase: 'queued', ahead: 1 },
    });

    cancelJob(B.id);
    expect(getJobState(B.id)).toMatchObject({ phase: 'error', code: 'CANCELLED' });
    releaseA();
    await batch;
    expect(extract.mock.calls.map((c) => c[0].id)).toEqual([A.id]);
    expect(getJobState(A.id).phase).toBe('done');
    expect(getJobState(B.id)).toMatchObject({ code: 'CANCELLED' });
  });

  it('Summarize on a queued batch item joins it instead of running a parallel duplicate', async () => {
    const A = yt();
    const B = yt();
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const extract = vi.fn(async (v: DetectedVideo) => {
      if (v.id === A.id) await gateA;
      return transcriptOf(v);
    });
    captions(extract);
    vi.mocked(summarize).mockImplementation(async (t) => summaryOf(t.videoId));

    const batch = runBatch([A, B], vi.fn());
    const own = runJob({ ...B, id: 'rescanned-B' }, vi.fn());
    await tick();
    expect(extract.mock.calls.map((c) => c[0].id)).toEqual([A.id]);
    releaseA();
    await expect(own).resolves.toBe(B.id);
    await batch;
    expect(extract.mock.calls.map((c) => c[0].id)).toEqual([A.id, B.id]);
  });

  it('a cancelled running item lets the next one start', async () => {
    const A = yt();
    const B = yt();
    const extract = vi.fn((v: DetectedVideo, signal?: AbortSignal) =>
      v.id === A.id
        ? rejectOnAbort(signal, new DOMException('aborted', 'AbortError'))
        : Promise.resolve(transcriptOf(v)),
    );
    captions(extract);
    vi.mocked(summarize).mockImplementation(async (t) => summaryOf(t.videoId));
    const batch = runBatch([A, B], vi.fn());
    await tick();
    cancelJob(A.id);
    await batch;
    expect(getJobState(B.id).phase).toBe('done');
  });
});

describe('watchdog', () => {
  it('a hung summary call times out at the phase budget and releases the keepalive', async () => {
    vi.useFakeTimers();
    const v = yt();
    vi.mocked(getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, timeoutSeconds: 60 });
    captions(async (video) => transcriptOf(video));
    vi.mocked(summarize).mockReturnValue(new Promise(() => {})); // ignores its signal
    const done = runJob(v, vi.fn());
    // 60 s base + 60 s / 4 of media.
    await vi.advanceTimersByTimeAsync(76 * 1000);
    await done;
    expect(getJobState(v.id)).toMatchObject({ phase: 'error', code: 'TIMEOUT' });
    expect(releases.at(-1)).toHaveBeenCalledOnce();
  });

  it('a hung captions fetch times out too', async () => {
    vi.useFakeTimers();
    const v = yt();
    vi.mocked(getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, timeoutSeconds: 30 });
    captions(() => new Promise(() => {}));
    const done = runJob(v, vi.fn());
    await vi.advanceTimersByTimeAsync(31 * 1000);
    await done;
    expect(getJobState(v.id)).toMatchObject({ phase: 'error', code: 'TIMEOUT' });
  });
});

describe('storage writes', () => {
  it('300 progress events in a burst cause at most a few session writes', async () => {
    vi.useFakeTimers();
    const v = yt({ provider: 'native', externalId: '', mediaSrc: 'https://x.test/b.mp4' });
    vi.mocked(selectAdapter).mockReturnValue(null);
    let writesDuringBurst = -1;
    vi.mocked(audioTranscriber.transcribe).mockImplementation(async (video, _s, onProgress) => {
      const before = sessionSet.mock.calls.length;
      for (let i = 0; i < 300; i++) {
        onProgress(`seg ${i}`, 'download', { done: i, total: 300, unit: 'items' });
        vi.advanceTimersByTime(3); // ~1 s in total
      }
      writesDuringBurst = sessionSet.mock.calls.length - before;
      return { ...transcriptOf(video), source: 'audio_transcription' };
    });
    vi.mocked(summarize).mockImplementation(async (t) => summaryOf(t.videoId));
    await runJob(v, vi.fn());
    expect(writesDuringBurst).toBeGreaterThanOrEqual(0);
    expect(writesDuringBurst).toBeLessThanOrEqual(3);
  });

  it('persists a done job as a reference to its cached summary, never the summary', async () => {
    const v = yt();
    captions(async (video) => transcriptOf(video));
    vi.mocked(summarize).mockImplementation(async (t) => summaryOf(t.videoId));
    await runJob(v, vi.fn());
    const last = writes.at(-1) as { 'tldw.jobs': StoredSnapshot };
    const stored = last['tldw.jobs'].jobs[v.id];
    expect(stored).toMatchObject({
      phase: 'done',
      cached: { provider: 'youtube', externalId: v.externalId },
    });
    expect(JSON.stringify(last)).not.toContain('summary body');
  });

  it('keeps a summary built from partial media in history, never in the cache', async () => {
    // Regression (v0.4.0 RC review): a partial audio summary — paid for — was
    // saved nowhere, so it was lost once the worker went idle.
    const v = yt({ provider: 'native', externalId: '', mediaSrc: 'https://x.test/c.mp4' });
    vi.mocked(selectAdapter).mockReturnValue(null);
    vi.mocked(audioTranscriber.transcribe).mockImplementation(async (video) => ({
      ...transcriptOf(video, { partial: true }),
      source: 'audio_transcription',
    }));
    vi.mocked(summarize).mockImplementation(async (t) => summaryOf(t.videoId));
    vi.mocked(saveSummary).mockResolvedValue('nocache:k1');
    await runJob(v, vi.fn());
    expect(saveSummary).toHaveBeenCalledWith(
      'native',
      '',
      expect.objectContaining({ partial: true }),
      expect.anything(),
      { noCache: true },
    );
    const state = getJobState(v.id);
    expect(state).toMatchObject({ phase: 'done', summary: { partial: true } });
    // The persisted done job points to the history entry, so a revived worker finds it.
    const last = writes.at(-1) as { 'tldw.jobs': StoredSnapshot };
    expect(last['tldw.jobs'].jobs[v.id]).toMatchObject({
      phase: 'done',
      cached: { historyKey: 'nocache:k1' },
    });
    expect(log.warn).toHaveBeenCalledWith('summary not cached', {
      videoId: v.id,
      reason: 'partial transcript',
    });
  });

  it('rehydrates a done job saved outside the cache from its history key', async () => {
    const summary = { ...summaryOf('restored-nc'), partial: true };
    vi.mocked(findSummaryByKey).mockResolvedValue(summary);
    const store: JobStore = {
      load: vi.fn(async () => ({
        jobs: {
          'restored-nc': {
            phase: 'done' as const,
            videoId: 'restored-nc',
            cached: {
              provider: 'native',
              externalId: '',
              ref: { outputLanguage: 'en' },
              historyKey: 'nocache:k2',
            },
          },
        },
        lastJobId: 'restored-nc',
        keys: { 'restored-nc': 'native:#1234' },
      })),
      save: vi.fn(async () => {}),
    };
    await restoreJobs(store);
    expect(findSummaryByKey).toHaveBeenCalledWith('nocache:k2');
    expect(findCachedSummary).not.toHaveBeenCalled();
    expect(getJobState('restored-nc')).toEqual({
      phase: 'done',
      videoId: 'restored-nc',
      summary,
    });
  });

  it('logs a failed write instead of swallowing it', async () => {
    sessionSet.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
    const v = yt();
    captions(async (video) => transcriptOf(video));
    vi.mocked(summarize).mockImplementation(async (t) => summaryOf(t.videoId));
    await runJob(v, vi.fn());
    expect(log.warn).toHaveBeenCalledWith('job state not persisted', {
      error: expect.stringContaining('quota'),
    });
  });

  it('rehydrates a persisted done reference from the summary cache', async () => {
    const summary = summaryOf('restored-1');
    vi.mocked(findCachedSummary).mockResolvedValue(summary);
    const store: JobStore = {
      load: vi.fn(async () => ({
        jobs: {
          'restored-1': {
            phase: 'done' as const,
            videoId: 'restored-1',
            cached: { provider: 'youtube', externalId: 'r1', ref: { outputLanguage: 'en' } },
          },
        },
        lastJobId: 'restored-1',
        keys: { 'restored-1': 'youtube:r1' },
      })),
      save: vi.fn(async () => {}),
    };
    await restoreJobs(store);
    expect(findCachedSummary).toHaveBeenCalledWith('youtube', 'r1', { outputLanguage: 'en' });
    expect(getJobState('restored-1')).toEqual({ phase: 'done', videoId: 'restored-1', summary });
  });
});

describe('keepalive', () => {
  const settle = async (v: DetectedVideo, outcome: 'success' | 'error' | 'cancel') => {
    captions(async (video, signal) => {
      if (outcome === 'cancel') {
        return rejectOnAbort(signal, new DOMException('aborted', 'AbortError'));
      }
      if (outcome === 'error') throw new TldwError('SUMMARY_API_ERROR', 'boom');
      return transcriptOf(video);
    });
    vi.mocked(summarize).mockImplementation(async (t) => summaryOf(t.videoId));
    const done = runJob(v, vi.fn());
    expect(holdKeepalive).toHaveBeenCalledOnce();
    const release = releases[0];
    if (outcome === 'cancel') {
      await tick();
      cancelJob(v.id);
    }
    await done;
    expect(release).toHaveBeenCalledOnce();
    const states = new Set<JobState['phase']>([getJobState(v.id).phase]);
    return states;
  };

  it('is released when the job succeeds', async () => {
    expect(await settle(yt(), 'success')).toEqual(new Set(['done']));
  });

  it('is released when the job fails', async () => {
    expect(await settle(yt(), 'error')).toEqual(new Set(['error']));
  });

  it('is released when the job is cancelled', async () => {
    expect(await settle(yt(), 'cancel')).toEqual(new Set(['error']));
  });
});
