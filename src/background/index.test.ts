import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Service-worker message routing, end to end through `chrome.runtime.onMessage`
 * (src/background/index.ts) with a fake chrome API. Regression tests ported
 * from independent reviewer reproductions of the v0.4.0 release candidate:
 * each failed on that build.
 */

type Listener = (...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
function event() {
  const listeners: Listener[] = [];
  return { addListener: (l: Listener) => listeners.push(l), removeListener: vi.fn(), listeners };
}
function area() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn(async (k: unknown) =>
      k == null ? { ...data } : typeof k === 'string' ? (k in data ? { [k]: data[k] } : {}) : {},
    ),
    set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(data, o)),
    remove: vi.fn(async (k: string | string[]) => {
      for (const key of [k].flat()) delete data[key];
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chromeMock: any;
beforeEach(() => {
  vi.resetModules();
  chromeMock = {
    runtime: {
      id: 'EXT',
      onMessage: event(),
      onConnect: event(),
      getManifest: () => ({ version: '0.4.0', content_scripts: [] }),
      sendMessage: vi.fn(async () => undefined),
      getContexts: vi.fn(async () => []),
      getURL: (p: string) => `chrome-extension://EXT/${p}`,
      getPlatformInfo: vi.fn(async () => ({})),
    },
    tabs: {
      onRemoved: event(),
      onUpdated: event(),
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage: vi.fn(async () => undefined),
      get: vi.fn(async () => ({ id: 7 })),
    },
    webRequest: { onBeforeRequest: event() },
    storage: { session: area(), local: area(), onChanged: event() },
    offscreen: {
      closeDocument: vi.fn(async () => {}),
      hasDocument: vi.fn(async () => false),
      createDocument: vi.fn(),
    },
    scripting: { executeScript: vi.fn() },
  };
  vi.stubGlobal('chrome', chromeMock);
  vi.stubGlobal('self', { addEventListener: vi.fn() });
  vi.stubGlobal('navigator', { userAgent: 'x', language: 'en' });
});

/** Dispatches `msg` to every onMessage listener; resolves with the response (or NO_RESPONSE). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function send(msg: unknown, sender: unknown): Promise<any> {
  return new Promise((resolve) => {
    let async = false;
    for (const l of chromeMock.runtime.onMessage.listeners) {
      if (l(msg, sender, resolve) === true) async = true;
    }
    if (!async) setTimeout(() => resolve('NO_RESPONSE'), 50);
  });
}

const POPUP = { id: 'EXT', url: 'chrome-extension://EXT/src/popup/index.html' };
/** A content script of ours, in a sub-frame of a hostile page. */
const PAGE_FRAME = {
  id: 'EXT',
  tab: { id: 99 },
  frameId: 3,
  url: 'https://evil.example/',
  origin: 'https://evil.example',
};
const VIDEO = {
  id: 'atk',
  provider: 'native',
  externalId: '',
  title: 't',
  duration: 10,
  iframeSrc: null,
  mediaSrc: 'https://intranet.corp/x.mp4',
  isPlaying: false,
};

describe('popup-only requests refuse content scripts', () => {
  it('GET_JOBS does not leak jobs (other tabs, summaries) to a page frame', async () => {
    chromeMock.storage.session.data['tldw.jobs'] = {
      jobs: {
        v1: { phase: 'error', videoId: 'v1', code: 'UNKNOWN', message: 'x', detail: 'secret' },
      },
      lastJobId: 'v1',
      keys: { v1: 'youtube:PRIVATEVID01' },
    };
    await import('./index');
    const res = await send({ type: 'GET_JOBS' }, PAGE_FRAME);
    expect(res).toMatchObject({ ok: false, message: 'forbidden' });
    expect(JSON.stringify(res)).not.toContain('PRIVATEVID01');
    // The popup still gets them.
    const own = await send({ type: 'GET_JOBS' }, POPUP);
    expect(JSON.stringify(own)).toContain('PRIVATEVID01');
  });

  it('SUMMARIZE / SUMMARIZE_BATCH from a page frame start no paid job', async () => {
    await import('./index');
    const one = await send({ type: 'SUMMARIZE', video: VIDEO }, PAGE_FRAME);
    const batch = await send({ type: 'SUMMARIZE_BATCH', videos: [VIDEO] }, PAGE_FRAME);
    expect(one).toMatchObject({ ok: false });
    expect(batch).toMatchObject({ ok: false });
    const { getJobState } = await import('./orchestrator');
    expect(getJobState('atk')).toEqual({ phase: 'idle' });
  });

  it.each([
    [{ type: 'LIST_VIDEOS' }],
    [{ type: 'RESCAN' }],
    [{ type: 'CANCEL', videoId: 'v1' }],
    [{ type: 'CLEAR_LOGS' }],
    [{ type: 'GET_DIAGNOSTICS' }],
  ])('%j is refused to a page frame', async (msg) => {
    await import('./index');
    expect(await send(msg, PAGE_FRAME)).toMatchObject({ ok: false, message: 'forbidden' });
  });

  it('refuses another extension and a sender without URL', async () => {
    await import('./index');
    const foreign = { id: 'OTHER', url: 'chrome-extension://OTHER/x.html' };
    expect(await send({ type: 'GET_JOBS' }, foreign)).toMatchObject({ ok: false });
    expect(await send({ type: 'GET_JOBS' }, { id: 'EXT' })).toMatchObject({ ok: false });
  });
});

describe('content publishes', () => {
  const frame = (doc: string, frameId = 3) => ({
    id: 'EXT',
    tab: { id: 7 },
    frameId,
    documentId: doc,
    url: 'https://player.example/',
  });
  const vid = { ...VIDEO, id: 'n1', mediaSrc: 'https://cdn.example/new.mp4', isPlaying: true };

  it('a late retraction of a previous document leaves the new document captures alone', async () => {
    await import('./index');
    const { getCapturedMedia } = await import('./media-capture');
    await send(
      { type: 'VIDEOS_DETECTED', videos: [{ ...vid, mediaSrc: 'https://cdn.example/old.mp4' }] },
      frame('doc1'),
    );
    await send({ type: 'VIDEOS_DETECTED', videos: [vid] }, frame('doc2'));
    for (const l of chromeMock.webRequest.onBeforeRequest.listeners) {
      l({ tabId: 7, frameId: 3, url: 'https://cdn.example/master.m3u8' });
    }
    expect(getCapturedMedia(7)).toHaveLength(1);
    // doc1's pagehide retraction arrives late.
    await send({ type: 'VIDEOS_DETECTED', videos: [] }, frame('doc1'));
    const list = await send({ type: 'LIST_VIDEOS' }, POPUP);
    expect(list.videos).toHaveLength(1);
    expect(getCapturedMedia(7)).toHaveLength(1);
    // The current document's own retraction still clears them.
    await send({ type: 'VIDEOS_DETECTED', videos: [] }, frame('doc2'));
    expect(getCapturedMedia(7)).toHaveLength(0);
  });

  it('scopes a publish to the sender frame and drops malformed entries', async () => {
    await import('./index');
    await send(
      {
        type: 'VIDEOS_DETECTED',
        videos: [
          { ...vid, frameId: 0, extra: 'x' }, // frameId from the wire is ignored
          { ...vid, id: 42 }, // malformed id
          { ...vid, id: 'bad-provider', provider: 'evil' },
          'not a video',
        ],
      },
      frame('doc1', 5),
    );
    const list = await send({ type: 'LIST_VIDEOS' }, POPUP);
    expect(list.videos).toHaveLength(1);
    expect(list.videos[0]).toMatchObject({ id: 'n1', frameId: 5 });
    expect(list.videos[0]).not.toHaveProperty('extra');
  });

  it('ignores an oversized or non-array publish, and one from an extension page', async () => {
    await import('./index');
    const many = Array.from({ length: 101 }, (_, i) => ({ ...vid, id: `v${i}` }));
    await send({ type: 'VIDEOS_DETECTED', videos: many }, frame('doc1'));
    await send({ type: 'VIDEOS_DETECTED', videos: 'x' }, frame('doc1'));
    await send({ type: 'VIDEOS_DETECTED', videos: [vid] }, { ...POPUP, tab: { id: 7 } });
    const list = await send({ type: 'LIST_VIDEOS' }, POPUP);
    expect(list.videos).toEqual([]);
  });
});

describe('popup list after a worker restart and a navigation', () => {
  it('does not serve the previous page videos while the verification is in flight', async () => {
    const old = {
      id: 'o1',
      provider: 'youtube',
      externalId: 'OLDPAGEVID1',
      title: 'old page',
      duration: null,
      iframeSrc: null,
      mediaSrc: null,
      isPlaying: false,
    };
    chromeMock.storage.session.data['frames:7'] = [[0, [old]]];
    vi.useFakeTimers();
    try {
      await import('./index');
      // Tab 7 navigated to a page without video while the worker was dead: its
      // pagehide retraction was lost, and the new page's script stays silent.
      for (const l of chromeMock.tabs.onUpdated.listeners) l(7, { status: 'complete' });
      const first = send({ type: 'LIST_VIDEOS' }, POPUP);
      await vi.advanceTimersByTimeAsync(2000);
      expect((await first).videos).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers from the mirror at once when no verification is pending', async () => {
    const kept = {
      id: 'k1',
      provider: 'youtube',
      externalId: 'KEPTVIDEO01',
      title: 'same page',
      duration: null,
      iframeSrc: null,
      mediaSrc: null,
      isPlaying: false,
    };
    chromeMock.storage.session.data['frames:7'] = [[0, [kept]]];
    await import('./index');
    const started = performance.now();
    const list = await send({ type: 'LIST_VIDEOS' }, POPUP);
    expect(performance.now() - started).toBeLessThan(100);
    expect(list.videos.map((v: { externalId: string }) => v.externalId)).toEqual(['KEPTVIDEO01']);
  });
});
