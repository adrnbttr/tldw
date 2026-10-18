import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, TldwError } from '@/types';
import type { DetectedVideo, Summary, Transcript } from '@/types';
import { findCachedSummary, getSettings, saveSummary } from '@/storage';
import type { Adapter } from '@/adapters';
import { selectAdapter } from '@/adapters';
import { summarize } from '@/summarizer';
import { log } from './log';
import type { JobStore, JobsSnapshot } from './job-store';
import { getJobState, getKeyedJobs, restoreJobs, runJob, runningJobIdFor } from './orchestrator';

/**
 * Unit tests of the orchestrator's logging: the heavy collaborators
 * (storage, adapters, summarizer) are mocked and `./log` is replaced by
 * spies, so the assertions read exactly what the worker's buffer receives.
 */
vi.mock('@/storage', () => ({
  getSettings: vi.fn(),
  findCachedSummary: vi.fn(),
  saveSummary: vi.fn(),
}));
vi.mock('@/adapters', () => ({
  selectAdapter: vi.fn(),
}));
vi.mock('@/summarizer', () => ({
  summarize: vi.fn(),
  summarizeYouTubeVideo: vi.fn(),
}));
vi.mock('./log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const video: DetectedVideo = {
  id: 'video-1',
  provider: 'youtube',
  externalId: 'abc123',
  title: 'Some video',
  duration: 120,
  iframeSrc: 'https://www.youtube.com/embed/dQw4w9WgXcQ?si=SIGNED_TOKEN',
  mediaSrc: null,
  isPlaying: true,
};

const transcript: Transcript = {
  videoId: video.id,
  source: 'youtube_captions',
  language: 'en',
  duration: 120,
  segments: [{ start: 0, end: 2, text: 'Hello world.' }],
  fullText: 'Hello world.',
  metadata: {
    title: video.title,
    provider: video.provider,
    extractedAt: '2026-10-17T00:00:00.000Z',
  },
};

const summary: Summary = {
  videoId: video.id,
  title: video.title ?? 'Untitled video',
  provider: video.provider,
  durationLabel: '2 min',
  transcriptSource: 'youtube_captions',
  createdAt: '2026-10-17T00:00:00.000Z',
  locale: 'en',
  detailLevel: 'standard',
  model: 'model-x',
  content: {
    tldr: 'A video.',
    keyPoints: [],
    sections: [],
    glossary: [],
    takeaways: [],
  },
  markdown: '# Some video',
};

const jobError = new TldwError(
  'SUMMARY_API_ERROR',
  'Generating the summary failed.',
  'HTTP 500: upstream unavailable',
);

const adapter: Adapter = {
  provider: 'youtube',
  canHandle: () => true,
  extractCaptions: vi.fn(async () => transcript),
};

const broadcast = vi.fn();

describe('orchestrator logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockResolvedValue(DEFAULT_SETTINGS);
    vi.mocked(findCachedSummary).mockResolvedValue(null);
    vi.mocked(selectAdapter).mockReturnValue(adapter);
    vi.mocked(summarize).mockRejectedValue(jobError);
  });

  it('a job failure produces an error entry carrying the code', async () => {
    await runJob(video, broadcast);

    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledWith(
      'job failed',
      expect.objectContaining({
        videoId: video.id,
        provider: video.provider,
        code: 'SUMMARY_API_ERROR',
        providerMessage: 'HTTP 500: upstream unavailable',
      }),
    );
    // The stack is the evidence a user report can't do without.
    const data = vi.mocked(log.error).mock.calls[0][1] as { stack?: string };
    expect(typeof data.stack).toBe('string');
  });

  it('logs the job start with a URL stripped to host + coarse path', async () => {
    await runJob(video, broadcast);

    expect(log.info).toHaveBeenCalledWith(
      'job started',
      expect.objectContaining({
        videoId: video.id,
        provider: 'youtube',
        // ?si=SIGNED_TOKEN never enters the log — host + coarse path only.
        url: 'www.youtube.com/embed/dQw4w9WgXcQ',
      }),
    );
  });

  it('logs each step transition at debug level', async () => {
    await runJob(video, broadcast);

    expect(log.debug).toHaveBeenCalledWith(
      'job step',
      expect.objectContaining({ videoId: video.id, step: 'captions', status: 'active' }),
    );
    expect(log.debug).toHaveBeenCalledWith(
      'job step',
      expect.objectContaining({ videoId: video.id, step: 'summarize', status: 'active' }),
    );
  });

  it('logs the finish of a successful job with its duration', async () => {
    vi.mocked(summarize).mockResolvedValue(summary);

    await runJob(video, broadcast);

    expect(log.error).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      'job done',
      expect.objectContaining({
        videoId: video.id,
        provider: 'youtube',
        durationMs: expect.any(Number),
      }),
    );
  });

  it('warns once per job interrupted by a worker restart, never for terminal jobs', async () => {
    const snapshot: JobsSnapshot = {
      jobs: {
        'running-1': { phase: 'running', videoId: 'running-1', steps: [] },
        'failed-1': {
          phase: 'error',
          videoId: 'failed-1',
          code: 'TIMEOUT',
          message: 'Processing exceeded the time limit. Try a shorter video.',
        },
      },
      lastJobId: 'running-1',
    };
    const store: JobStore = {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => {}),
    };

    await restoreJobs(store);

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith('job interrupted by worker restart', {
      videoId: 'running-1',
    });
  });
});

describe('orchestrator job identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockResolvedValue(DEFAULT_SETTINGS);
    vi.mocked(findCachedSummary).mockResolvedValue(null);
    vi.mocked(selectAdapter).mockReturnValue(adapter);
    vi.mocked(adapter.extractCaptions).mockResolvedValue(transcript);
  });

  it('joins the running job when the same video is launched again under a new local id', async () => {
    let finish!: (s: Summary) => void;
    vi.mocked(summarize).mockReturnValue(new Promise<Summary>((r) => (finish = r)));
    const first = runJob({ ...video, id: 'scan-1' }, broadcast);
    const second = runJob({ ...video, id: 'scan-2' }, broadcast);
    expect(runningJobIdFor({ ...video, id: 'scan-3' })).toBe('scan-1');
    await vi.waitFor(() => expect(summarize).toHaveBeenCalled());
    finish(summary);
    await expect(first).resolves.toBe('scan-1');
    await expect(second).resolves.toBe('scan-1');
    expect(adapter.extractCaptions).toHaveBeenCalledOnce();
    expect(getJobState('scan-2')).toEqual({ phase: 'idle' });
    expect(getKeyedJobs()).toContainEqual({
      key: 'youtube:abc123',
      state: expect.objectContaining({ phase: 'done', videoId: 'scan-1' }),
    });
    expect(runningJobIdFor(video)).toBeNull();
  });

  it('never caches a summary whose audio source was not attributable to the video', async () => {
    vi.mocked(summarize).mockResolvedValue(summary);
    vi.mocked(adapter.extractCaptions).mockResolvedValue({
      ...transcript,
      metadata: { ...transcript.metadata, sourceAttributed: false },
    });
    await runJob({ ...video, id: 'unattributed' }, broadcast);
    // Kept in history (a paid result), under a non-cacheable key only.
    expect(saveSummary).toHaveBeenCalledTimes(1);
    expect(saveSummary).toHaveBeenCalledWith('youtube', 'abc123', summary, expect.anything(), {
      noCache: true,
    });
    expect(getJobState('unattributed')).toMatchObject({ phase: 'done' });
    // Not a partial transcript: no partial notice.
    expect(getJobState('unattributed')).not.toMatchObject({ summary: { partial: true } });
  });

  it('caches an attributable summary under the video key', async () => {
    vi.mocked(summarize).mockResolvedValue(summary);
    await runJob({ ...video, id: 'attributed' }, broadcast);
    expect(saveSummary).toHaveBeenCalledWith(
      'youtube',
      'abc123',
      summary,
      expect.objectContaining({ outputLanguage: DEFAULT_SETTINGS.outputLanguage }),
    );
    expect(findCachedSummary).toHaveBeenCalledWith(
      'youtube',
      'abc123',
      expect.objectContaining({ outputLanguage: DEFAULT_SETTINGS.outputLanguage }),
    );
    expect(adapter.extractCaptions).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      outputLanguage: DEFAULT_SETTINGS.outputLanguage,
    });
  });

  it('keys the cache on the selected summary model', async () => {
    vi.mocked(summarize).mockResolvedValue(summary);
    await runJob({ ...video, id: 'model-key' }, broadcast);
    const ref = expect.objectContaining({ summaryModel: DEFAULT_SETTINGS.summaryModel });
    expect(findCachedSummary).toHaveBeenCalledWith('youtube', 'abc123', ref);
    expect(saveSummary).toHaveBeenCalledWith('youtube', 'abc123', summary, ref);
  });

  it('a forced run (regenerate) skips the cache and replaces the entry', async () => {
    vi.mocked(findCachedSummary).mockResolvedValue({ ...summary, title: 'cached' });
    vi.mocked(summarize).mockResolvedValue(summary);
    await runJob({ ...video, id: 'forced' }, broadcast, { force: true });
    expect(findCachedSummary).not.toHaveBeenCalled();
    expect(summarize).toHaveBeenCalled();
    expect(saveSummary).toHaveBeenCalledWith('youtube', 'abc123', summary, expect.anything());
    expect(getJobState('forced')).toMatchObject({
      phase: 'done',
      summary: { title: 'Some video' },
    });
  });

  it('propagates retryAfter and the provider detail to the error state', async () => {
    vi.mocked(adapter.extractCaptions).mockRejectedValue(
      new TldwError('RATE_LIMITED', 'slow down', 'provider says wait', 12),
    );
    await runJob({ ...video, id: 'limited' }, broadcast);
    expect(getJobState('limited')).toMatchObject({
      phase: 'error',
      code: 'RATE_LIMITED',
      detail: 'provider says wait',
      retryAfter: 12,
      // Absolute failure time: the popup's countdown survives a reopen.
      failedAt: expect.any(Number),
    });
  });

  it('attaches a monotonic progress to running states', async () => {
    const seen: number[] = [];
    vi.mocked(summarize).mockResolvedValue(summary);
    await runJob({ ...video, id: 'prog' }, (state) => {
      if (state.phase === 'running' && state.progress) seen.push(state.progress.percent);
    });
    expect(seen.length).toBeGreaterThan(0);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});
