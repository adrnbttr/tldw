import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyMedia } from '@/transcription/media';

type RequestListener = (details: { tabId: number; frameId: number; url: string }) => void;
type UpdatedListener = (tabId: number, changeInfo: { url?: string; status?: string }) => void;

let onRequest: RequestListener;
let onUpdated: UpdatedListener;
let filterUrls: string[];

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('chrome', {
    webRequest: {
      onBeforeRequest: {
        addListener: (l: RequestListener, filter: { urls: string[] }) => {
          onRequest = l;
          filterUrls = filter.urls;
        },
      },
    },
    tabs: {
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: (l: UpdatedListener) => (onUpdated = l) },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

async function load() {
  const mod = await import('./media-capture');
  mod.installMediaCapture();
  return mod;
}

const HLS = 'https://cdn.example/a.m3u8';
const DRIVE = 'https://rr1---sn-x.c.drive.google.com/videoplayback?mime=video%2Fmp4&range=0-9';

describe('media capture', () => {
  it('records the issuing frame with each capture', async () => {
    const { getCapturedMedia } = await load();
    onRequest({ tabId: 3, frameId: 5, url: HLS });
    expect(getCapturedMedia(3)).toEqual([{ url: HLS, kind: 'hls', frameId: 5 }]);
  });

  it("drops a tab's captures when its top-level URL changes, not on a bare 'loading'", async () => {
    const { getCapturedMedia } = await load();
    onRequest({ tabId: 3, frameId: 0, url: HLS });
    onUpdated(3, { status: 'loading' });
    expect(getCapturedMedia(3)).toHaveLength(1);
    onUpdated(3, { url: 'https://example.com/next' });
    expect(getCapturedMedia(3)).toEqual([]);
  });

  it("drops only one frame's captures", async () => {
    const { getCapturedMedia, clearFrameCaptures } = await load();
    onRequest({ tabId: 3, frameId: 5, url: HLS });
    onRequest({ tabId: 3, frameId: 6, url: DRIVE });
    clearFrameCaptures(3, 5);
    expect(getCapturedMedia(3).map((c) => c.frameId)).toEqual([6]);
  });

  it('listens only to media-looking URLs, Drive stream hosts included', async () => {
    await load();
    expect(filterUrls).not.toContain('<all_urls>');
    expect(filterUrls).toEqual(
      expect.arrayContaining([
        '*://*.googlevideo.com/*',
        '*://*.c.drive.google.com/*',
        '*://*.c.docs.google.com/*',
        '*://*/*.m3u8*',
      ]),
    );
  });

  it('covers every URL shape classifyMedia accepts (filter ⊇ classifier)', async () => {
    const { MEDIA_URL_PATTERNS } = await load();
    // Chrome match pattern → RegExp (scheme `*` = http/https; host `*.x` = x and
    // its subdomains; path glob matched against path + query).
    const toRegExp = (pattern: string) => {
      const [, scheme, host, path] = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern)!;
      const esc = (x: string) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      const hostRe =
        host === '*'
          ? '[^/]+'
          : host.startsWith('*.')
            ? `(?:[^/]+\\.)?${esc(host.slice(2))}`
            : esc(host);
      const pathRe = path.split('*').map(esc).join('.*');
      return new RegExp(`^${scheme === '*' ? 'https?' : scheme}://${hostRe}${pathRe}$`);
    };
    const patterns = MEDIA_URL_PATTERNS.map(toRegExp);
    const samples = [
      'https://x/v/master.json?base64_init=1',
      'https://x/v/playlist.json',
      'https://x/a.m3u8?token=1',
      'https://x/a.mpd',
      'https://x/a.mp4?sig=2',
      'https://x/a.m4s',
      'https://x/a.ts',
      'https://x/segment-1',
      'https://skyfire.vimeocdn.com/1/audio/2',
      'https://rr3---sn-x.googlevideo.com/videoplayback?mime=audio%2Fmp4',
      'https://rr2---sn-x.c.docs.google.com/videoplayback?mime=video%2Fmp4',
      DRIVE,
      // Upper-case extensions (match patterns are case-sensitive).
      'https://x/A.MP4',
      'https://x/a.M3U8?x=1',
      'https://x/a.MPD',
      'https://x/a.TS',
      'https://x/a.M4S?r=2',
    ];
    for (const url of samples) {
      expect(classifyMedia(url), url).not.toBe('unknown');
      expect(
        patterns.some((re) => re.test(url)),
        url,
      ).toBe(true);
    }
  });

  it('does not take /api/segments or a .tsv file for media', async () => {
    const { MEDIA_URL_PATTERNS } = await load();
    for (const url of ['https://x/api/segments', 'https://x/data.tsv', 'https://x/app.tsx']) {
      expect(classifyMedia(url), url).toBe('unknown');
      // No pattern ends in a way that accepts them either.
      const loose = MEDIA_URL_PATTERNS.filter((p) => p.endsWith('segment*') || p.endsWith('.ts*'));
      expect(loose, url).toEqual([]);
    }
  });

  it('keeps captures across a hash-only change of the page URL', async () => {
    const { getCapturedMedia } = await load();
    onUpdated(3, { url: 'https://example.com/course' });
    onRequest({ tabId: 3, frameId: 0, url: HLS });
    onUpdated(3, { url: 'https://example.com/course#lesson-2' });
    expect(getCapturedMedia(3)).toHaveLength(1);
    onUpdated(3, { url: 'https://example.com/course/2' });
    expect(getCapturedMedia(3)).toEqual([]);
  });
});

describe('media capture persistence', () => {
  /** Shared chrome.storage.session fake: survives a simulated worker restart. */
  const data = new Map<string, unknown>();
  const session = {
    get: vi.fn(async (key: string) => (data.has(key) ? { [key]: data.get(key) } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) data.set(k, JSON.parse(JSON.stringify(v)));
    }),
  };

  async function freshWorker() {
    vi.resetModules();
    vi.stubGlobal('chrome', {
      storage: { session },
      webRequest: {
        onBeforeRequest: { addListener: (l: RequestListener) => (onRequest = l) },
      },
      tabs: {
        onRemoved: { addListener: vi.fn() },
        onUpdated: { addListener: (l: UpdatedListener) => (onUpdated = l) },
      },
    });
    const mod = await import('./media-capture');
    mod.installMediaCapture();
    await mod.capturesReady();
    return mod;
  }

  it('a manifest captured before a worker restart is still there after it', async () => {
    vi.useFakeTimers();
    data.clear();
    const first = await freshWorker();
    onUpdated(4, { url: 'https://lms.example/lesson' });
    onRequest({ tabId: 4, frameId: 2, url: HLS });
    await vi.advanceTimersByTimeAsync(1000); // debounced write
    expect(first.getCapturedMedia(4)).toHaveLength(1);
    vi.useRealTimers();

    const second = await freshWorker();
    expect(second.getCapturedMedia(4)).toEqual([{ url: HLS, kind: 'hls', frameId: 2 }]);
    // The restored page URL still tells a navigation from a hash change.
    onUpdated(4, { url: 'https://lms.example/lesson#t=10' });
    expect(second.getCapturedMedia(4)).toHaveLength(1);
    onUpdated(4, { url: 'https://lms.example/other' });
    expect(second.getCapturedMedia(4)).toEqual([]);
  });
});
