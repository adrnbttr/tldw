import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedVideo, JobState } from '@/types';

/**
 * Time-to-summary on the captions path, in virtual time: the real
 * orchestrator, storage layer, Vimeo adapter and summarizer run against a
 * fake `chrome.storage.local` and a fake `fetch` with FIXED latencies, under
 * fake timers — so the measured wall time is exactly the job's critical path
 * (which awaits are serial), independent of the machine.
 */

const LAT = {
  storageGet: 5,
  storageSet: 10,
  vimeoConfig: 150,
  vimeoVtt: 100,
  chat: 2000,
};

vi.mock('./log', () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const later = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

function installFakes(local: Record<string, unknown>) {
  const counts = { storageGet: 0, storageSet: 0, fetch: [] as string[] };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (key: string) => {
          counts.storageGet++;
          return later(LAT.storageGet, key in local ? { [key]: structuredClone(local[key]) } : {});
        },
        set: (o: Record<string, unknown>) => {
          counts.storageSet++;
          Object.assign(local, structuredClone(o));
          return later(LAT.storageSet, undefined);
        },
      },
      session: { get: async () => ({}), set: async () => undefined },
    },
    runtime: { getPlatformInfo: async () => ({}) },
    i18n: { getUILanguage: () => 'en' },
  });
  const content = JSON.stringify({
    tldr: 't',
    keyPoints: ['k'],
    sections: [{ heading: 'h', body: 'b' }],
    glossary: [],
    takeaways: [],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      counts.fetch.push(url.replace(/^https:\/\/([^/]+).*$/, '$1'));
      if (url.endsWith('/config')) {
        return later(LAT.vimeoConfig, {
          ok: true,
          status: 200,
          json: async () => ({
            request: { text_tracks: [{ lang: 'en', url: 'https://vimeo.com/t.vtt' }] },
          }),
        });
      }
      if (url.endsWith('.vtt')) {
        return later(LAT.vimeoVtt, {
          ok: true,
          status: 200,
          text: async () => 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello world.\n',
        });
      }
      return later(LAT.chat, {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ choices: [{ message: { content } }] }),
      });
    }),
  );
  return counts;
}

const video: DetectedVideo = {
  id: 'v1',
  provider: 'vimeo',
  externalId: '123',
  title: 'T',
  duration: 60,
  iframeSrc: 'https://player.vimeo.com/video/123',
  mediaSrc: null,
  isPlaying: false,
};

async function timeToDone(local: Record<string, unknown>) {
  const counts = installFakes(local);
  const { runJob } = await import('./orchestrator');
  const start = Date.now();
  let doneAt = -1;
  const broadcast = (s: JobState) => {
    if (s.phase === 'done' && doneAt < 0) doneAt = Date.now() - start;
  };
  const finished = runJob({ ...video, id: `v-${Math.random()}` }, broadcast);
  await vi.runAllTimersAsync();
  await finished;
  return { doneAt, counts };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('time to summary (captions path, fixed fake latencies)', () => {
  const settings = { openRouterKey: 'k', outputLanguage: 'en', uiLanguage: 'en' };

  it('cache miss: network-bound, storage adds 4 reads + 1 write', async () => {
    const { doneAt, counts } = await timeToDone({ settings, history: [] });
    // eslint-disable-next-line no-console
    console.log('[time-to-summary] miss', { doneAt, ...counts, fetch: counts.fetch.join(' → ') });
    // The three requests are data-dependent (config → track URL → transcript
    // → summary): nothing to parallelize there.
    expect(counts.fetch).toEqual(['player.vimeo.com', 'vimeo.com', 'openrouter.ai']);
    const network = LAT.vimeoConfig + LAT.vimeoVtt + LAT.chat;
    // Settings + cache lookup before, settings + history read + write after.
    expect(doneAt).toBeLessThanOrEqual(network + 4 * LAT.storageGet + LAT.storageSet);
  });

  it('cache hit: two storage reads, no request', async () => {
    const local = { settings, history: [] as unknown[] };
    await timeToDone(local); // fills the cache
    vi.resetModules();
    const { doneAt, counts } = await timeToDone(local);
    // eslint-disable-next-line no-console
    console.log('[time-to-summary] hit', { doneAt, ...counts });
    expect(counts.fetch).toEqual([]);
    expect(doneAt).toBeLessThanOrEqual(2 * LAT.storageGet);
  });
});
