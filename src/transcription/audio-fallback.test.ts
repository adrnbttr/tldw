import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/types';
import type { DetectedVideo, Settings } from '@/types';
import type { MediaCandidate } from './media';
import type { OffscreenRequest, OffscreenResponse, TranscribeJob } from './offscreen-protocol';

/**
 * Regression tests of the worker side of the audio fallback (tab
 * attribution, segment-only captures, queue, offscreen boundary). Ported from
 * independent reviewer reproductions.
 */

/** Captures per tab, editable by each test (and by a PRIME_MEDIA). */
const captures = new Map<number, MediaCandidate[]>();
const getCapturedMedia = vi.fn((tabId: number) => captures.get(tabId) ?? []);
vi.mock('@/background/media-capture', () => ({
  getCapturedMedia: (tabId: number) => getCapturedMedia(tabId),
  capturesReady: async () => {},
}));

type Listener = (msg: OffscreenResponse, sender?: unknown) => void;
/** The offscreen document, as the worker sees it (an extension page). */
const OFFSCREEN_SENDER = { id: 'ext', url: 'chrome-extension://ext/src/offscreen/offscreen.html' };
let listeners: Listener[] = [];
/** What the fake offscreen answers to a job (default: one segment, ok). */
let answer: (job: TranscribeJob) => OffscreenResponse | null;
const sentJobs: TranscribeJob[] = [];
let onPrime: (tabId: number) => void = () => {};
const tabs = {
  query: vi.fn(async () => [{ id: 2 }]),
  get: vi.fn(async (id: number) => ({ id })),
  sendMessage: vi.fn(async (tabId: number) => onPrime(tabId)),
};
const offscreen = {
  hasDocument: vi.fn(async () => false),
  createDocument: vi.fn(async () => {}),
  closeDocument: vi.fn(async () => {}),
  Reason: { WORKERS: 'WORKERS' },
};
const runtimeSend = vi.fn(async (req: OffscreenRequest) => {
  sentJobs.push(req.job);
  const res = answer(req.job);
  if (res) queueMicrotask(() => [...listeners].forEach((l) => l(res, OFFSCREEN_SENDER)));
});

beforeEach(() => {
  vi.resetModules();
  captures.clear();
  listeners = [];
  sentJobs.length = 0;
  onPrime = () => {};
  vi.clearAllMocks();
  answer = (job) => ({
    type: 'OFFSCREEN_RESULT',
    jobId: job.jobId,
    ok: true,
    segments: [{ start: 0, end: 1, text: 'speech' }],
  });
  vi.stubGlobal('chrome', {
    tabs,
    offscreen,
    runtime: {
      id: 'ext',
      onMessage: {
        addListener: (l: Listener) => listeners.push(l),
        removeListener: (l: Listener) => (listeners = listeners.filter((x) => x !== l)),
      },
      sendMessage: runtimeSend,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settings: Settings = { ...DEFAULT_SETTINGS, openRouterKey: 'k' };

function video(over: Partial<DetectedVideo> = {}): DetectedVideo {
  return {
    id: 'v',
    provider: 'unknown',
    externalId: '',
    title: 'Lesson',
    duration: 600,
    iframeSrc: 'https://fast.wistia.net/embed/iframe/lesson2',
    mediaSrc: null,
    isPlaying: false,
    frameId: 5,
    ...over,
  };
}

describe('tab attribution', () => {
  it('reads captures from the tab the job was requested from, not the active one', async () => {
    captures.set(1, [
      { url: 'https://embed-ssl.wistia.com/deliveries/aaa.m3u8', kind: 'hls', frameId: 5 },
    ]);
    captures.set(2, [
      { url: 'https://cdn.other-site.com/other/master.m3u8', kind: 'hls', frameId: 0 },
    ]);
    const { audioTranscriber } = await import('./index');
    const tr = await audioTranscriber.transcribe(video(), settings, () => {}, undefined, {
      tabId: 1,
    });
    expect(sentJobs[0].sources.map((s) => s.url)).toEqual([
      'https://embed-ssl.wistia.com/deliveries/aaa.m3u8',
    ]);
    expect(tr.metadata.sourceAttributed).toBeUndefined();
    expect(tabs.query).not.toHaveBeenCalled();
  });

  it('primes the video in the job tab only', async () => {
    vi.useFakeTimers();
    onPrime = (tabId) => {
      captures.set(tabId, [{ url: `https://cdn.x/${tabId}/a.m3u8`, kind: 'hls', frameId: 5 }]);
    };
    const { audioTranscriber } = await import('./index');
    const p = audioTranscriber.transcribe(video(), settings, () => {}, undefined, { tabId: 7 });
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    expect(tabs.sendMessage).toHaveBeenCalledOnce();
    expect(tabs.sendMessage.mock.calls[0][0]).toBe(7);
    expect(sentJobs[0].sources[0].url).toBe('https://cdn.x/7/a.m3u8');
  });

  it('fails typed when the job tab is gone, without priming anything', async () => {
    tabs.get.mockRejectedValueOnce(new Error('No tab with id: 9'));
    const { audioTranscriber } = await import('./index');
    await expect(
      audioTranscriber.transcribe(video(), settings, () => {}, undefined, { tabId: 9 }),
    ).rejects.toMatchObject({ code: 'MEDIA_NEEDS_PLAYBACK' });
    expect(tabs.sendMessage).not.toHaveBeenCalled();
    expect(sentJobs).toHaveLength(0);
  });
});

describe('segment-only captures', () => {
  const segments: MediaCandidate[] = [
    { url: 'https://cdn.lms.example/v/seg-00412.ts', kind: 'segment', frameId: 5 },
    { url: 'https://cdn.lms.example/v/seg-00413.ts', kind: 'segment', frameId: 5 },
  ];

  it('never ships loose segments as the media: re-primes, then fails typed', async () => {
    vi.useFakeTimers();
    captures.set(1, segments);
    const { audioTranscriber } = await import('./index');
    const p = audioTranscriber
      .transcribe(video(), settings, () => {}, undefined, { tabId: 1 })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await p).toMatchObject({
      code: 'MEDIA_NEEDS_PLAYBACK',
      providerMessage: expect.stringContaining('segments'),
    });
    expect(tabs.sendMessage).toHaveBeenCalledOnce(); // re-capture attempted
    expect(sentJobs).toHaveLength(0);
  });

  it('uses the manifest the re-prime captured, without the segments', async () => {
    vi.useFakeTimers();
    captures.set(1, segments);
    onPrime = () =>
      captures.set(1, [
        { url: 'https://cdn.lms.example/v/index.m3u8', kind: 'hls', frameId: 5 },
        ...segments,
      ]);
    const { audioTranscriber } = await import('./index');
    const p = audioTranscriber.transcribe(video(), settings, () => {}, undefined, { tabId: 1 });
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    expect(sentJobs[0].sources.map((s) => s.kind)).toEqual(['hls']);
  });

  it('carries the offscreen "partial media" verdict onto the transcript', async () => {
    captures.set(1, [{ url: 'https://cdn.x/a.m3u8', kind: 'hls', frameId: 5 }]);
    answer = (job) => ({
      type: 'OFFSCREEN_RESULT',
      jobId: job.jobId,
      ok: true,
      partial: true,
      segments: [{ start: 0, end: 6, text: 'six seconds' }],
    });
    const { audioTranscriber } = await import('./index');
    const tr = await audioTranscriber.transcribe(video(), settings, () => {}, undefined, {
      tabId: 1,
    });
    expect(tr.metadata.partial).toBe(true);
  });
});

describe('offscreen boundary', () => {
  it('rebuilds retryAfter from a failed offscreen result', async () => {
    const { runInOffscreen } = await import('./index');
    const p = runInOffscreen({ jobId: 'j1' } as TranscribeJob, () => {}, 900);
    // Not from runtimeSend: the request is sent before this listener emits.
    [...listeners].forEach((l) =>
      l(
        {
          type: 'OFFSCREEN_RESULT',
          jobId: 'j1',
          ok: false,
          code: 'RATE_LIMITED',
          message: 'slow down',
          retryAfter: 30,
        },
        OFFSCREEN_SENDER,
      ),
    );
    await expect(p).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfter: 30 });
  });

  it('fails typed and closes the document when the offscreen page is unreachable', async () => {
    runtimeSend.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    const { audioTranscriber } = await import('./index');
    await expect(
      audioTranscriber.transcribe(
        video({ provider: 'native', mediaSrc: 'https://x.test/a.mp4' }),
        settings,
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'AUDIO_EXTRACTION_FAILED' });
    expect(offscreen.createDocument).toHaveBeenCalledOnce();
    expect(offscreen.closeDocument).toHaveBeenCalled();
  });
});

describe('queue', () => {
  it('resolves sources only once the slot is acquired, and updates "ahead" as the line moves', async () => {
    captures.set(1, [{ url: 'https://cdn.x/a.m3u8', kind: 'hls', frameId: 5 }]);
    const { audioTranscriber } = await import('./index');
    const { audioQueue } = await import('./offscreen-session');
    let free1!: () => void;
    let free2!: () => void;
    const busy1 = audioQueue.run(() => new Promise<void>((r) => (free1 = r)));
    const busy2 = audioQueue.run(() => new Promise<void>((r) => (free2 = r)));
    const ahead: number[] = [];
    const p = audioTranscriber.transcribe(
      video(),
      settings,
      (_d, phase, data) => {
        if (phase === 'queued') ahead.push(data?.ahead ?? -1);
      },
      undefined,
      { tabId: 1 },
    );
    await Promise.resolve();
    expect(ahead).toEqual([2]);
    expect(getCapturedMedia).not.toHaveBeenCalled();
    free1();
    await busy1;
    await vi.waitFor(() => expect(ahead).toEqual([2, 1]));
    expect(getCapturedMedia).not.toHaveBeenCalled();
    free2();
    await busy2;
    await p;
    expect(getCapturedMedia).toHaveBeenCalled();
  });

  it('a cancel during the prime wait rejects at once', async () => {
    vi.useFakeTimers();
    const { primeAndWait } = await import('./index');
    const controller = new AbortController();
    const p = primeAndWait(video(), 1, controller.signal).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await p).toMatchObject({ code: 'TIMEOUT' });
  });
});
