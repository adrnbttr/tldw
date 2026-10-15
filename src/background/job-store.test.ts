import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JobProgress, JobState, Summary } from '@/types';
import { ERROR_MESSAGES } from '@/types';
import { EMPTY_SNAPSHOT, markInterrupted, sessionJobStore, snapshotOf } from './job-store';

const running = (videoId: string, step: JobProgress['status'] = 'active'): JobState => ({
  phase: 'running',
  videoId,
  steps: [
    { videoId, step: 'detect', status: 'done' },
    { videoId, step: 'captions', status: step },
  ],
});

const done = (videoId: string): JobState => ({
  phase: 'done',
  videoId,
  summary: {
    videoId,
    title: 'A video',
    provider: 'youtube',
    durationLabel: '1 min',
    transcriptSource: 'youtube_captions',
    createdAt: '2026-10-15T00:00:00.000Z',
    locale: 'en',
    detailLevel: 'standard',
    model: 'some-model',
    content: {
      tldr: 'tldr',
      keyPoints: [],
      sections: [],
      glossary: [],
      takeaways: [],
    },
    markdown: '# summary',
  } satisfies Summary,
});

const failed: JobState = {
  phase: 'error',
  videoId: 'v-err',
  code: 'TIMEOUT',
  message: ERROR_MESSAGES.TIMEOUT,
};

describe('snapshotOf', () => {
  it('maps the live jobs Map into a plain record, with the last job id', () => {
    const jobs = new Map<string, JobState>([
      ['v1', running('v1')],
      ['v2', done('v2')],
    ]);
    expect(snapshotOf(jobs, 'v2')).toEqual({
      jobs: { v1: running('v1'), v2: done('v2') },
      lastJobId: 'v2',
    });
  });

  it('snapshots an empty state as an empty record and a null last id', () => {
    expect(snapshotOf(new Map(), null)).toEqual(EMPTY_SNAPSHOT);
  });
});

describe('markInterrupted', () => {
  it('converts persisted running jobs into a typed INTERRUPTED error', () => {
    const snapshot = markInterrupted({
      jobs: { v1: running('v1'), v2: done('v2'), 'v-err': failed },
      lastJobId: 'v1',
    });

    expect(snapshot.jobs.v1).toEqual({
      phase: 'error',
      videoId: 'v1',
      code: 'INTERRUPTED',
      message: ERROR_MESSAGES.INTERRUPTED,
    });
  });

  it('passes terminal states and the last job id through untouched', () => {
    const input = { jobs: { v2: done('v2'), 'v-err': failed }, lastJobId: 'v2' };
    expect(markInterrupted(input)).toEqual(input);
  });

  it('is idempotent — an already-converted snapshot round-trips unchanged', () => {
    const once = markInterrupted({ jobs: { v1: running('v1') }, lastJobId: 'v1' });
    expect(markInterrupted(once)).toEqual(once);
  });
});

describe('sessionJobStore', () => {
  /** Minimal chrome.storage.session fake backed by a Map. */
  const makeSessionStorage = () => {
    const data = new Map<string, unknown>();
    return {
      get: vi.fn(async (keys: string | string[]) => {
        const wanted = typeof keys === 'string' ? [keys] : keys;
        const out: Record<string, unknown> = {};
        for (const key of wanted) if (data.has(key)) out[key] = data.get(key);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) data.set(key, value);
      }),
    };
  };

  beforeEach(() => {
    vi.stubGlobal('chrome', { storage: { session: makeSessionStorage() } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a snapshot through a single session-storage key', async () => {
    const snapshot = { jobs: { v1: running('v1'), v2: done('v2') }, lastJobId: 'v1' };

    await sessionJobStore.save(snapshot);
    expect(chrome.storage.session.set).toHaveBeenCalledOnce();

    const loaded = await sessionJobStore.load();
    expect(loaded).toEqual(snapshot);
  });

  it('returns the empty snapshot when nothing was persisted', async () => {
    await expect(sessionJobStore.load()).resolves.toEqual(EMPTY_SNAPSHOT);
  });

  it('a running job saved before a worker restart loads back as INTERRUPTED', async () => {
    await sessionJobStore.save({ jobs: { v1: running('v1') }, lastJobId: 'v1' });

    const restored = markInterrupted(await sessionJobStore.load());

    expect(restored).toEqual({
      jobs: {
        v1: {
          phase: 'error',
          videoId: 'v1',
          code: 'INTERRUPTED',
          message: ERROR_MESSAGES.INTERRUPTED,
        },
      },
      lastJobId: 'v1',
    });
  });
});
