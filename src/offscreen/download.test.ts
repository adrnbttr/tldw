import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/en';
import type { TranscribeJob } from '@/transcription/offscreen-protocol';
import { TldwError } from '@/types';
import { downloadByRanges, downloadSource } from './download';

/** A 10-byte memory limit, so the budget is exercised without big buffers. */
const LIMIT = 10;
vi.mock('@/transcription/audio', () => ({
  assertMediaSize: (bytes: number) => {
    if (bytes > LIMIT) throw new TldwError('MEDIA_TOO_LARGE', 'too large');
  },
}));
import type { DownloadContext } from './download';

const URL_GV = 'https://rr1---sn-x.c.drive.google.com/videoplayback?mime=video%2Fmp4';

function ctx(): DownloadContext & { progress: ReturnType<typeof vi.fn> } {
  return { t: en.transcription, progress: vi.fn(), diag: [] };
}

function partial(body: Uint8Array<ArrayBuffer>, start: number, total: number): Response {
  return new Response(body, {
    status: 206,
    headers: { 'content-range': `bytes ${start}-${start + body.byteLength - 1}/${total}` },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('downloadByRanges', () => {
  it('keeps the 200 full body when the server ignores Range', async () => {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const c = ctx();

    const out = await downloadByRanges(URL_GV, c);
    expect(out).toEqual(body);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(c.diag).toContain('ranges unsupported → single fetch');
  });

  it('assembles 206 blocks and reports progress per block', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(partial(new Uint8Array([9]), 0, 3))
      .mockResolvedValueOnce(partial(new Uint8Array([7, 8, 9]), 0, 3));
    vi.stubGlobal('fetch', fetchMock);
    const c = ctx();

    await expect(downloadByRanges(URL_GV, c)).resolves.toEqual(new Uint8Array([7, 8, 9]));
    expect(c.progress).toHaveBeenCalledWith(
      'download',
      expect.stringContaining('Downloaded'),
      undefined,
      { done: 3, total: 3, unit: 'bytes' },
    );
  });

  it('fails typed on a block of the wrong size', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(partial(new Uint8Array([9]), 0, 3))
      .mockResolvedValueOnce(partial(new Uint8Array([7, 8]), 0, 3));
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadByRanges(URL_GV, ctx())).rejects.toMatchObject({
      code: 'MEDIA_NOT_CAPTURABLE',
    });
  });

  it('falls back (null) when a block comes back non-partial', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(partial(new Uint8Array([9]), 0, 3))
      .mockResolvedValueOnce(new Response(new Uint8Array(3), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadByRanges(URL_GV, ctx())).resolves.toBeNull();
  });

  it('refuses an announced total over the memory limit before downloading', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(partial(new Uint8Array([9]), 0, LIMIT + 1));
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadByRanges(URL_GV, ctx())).rejects.toMatchObject({
      code: 'MEDIA_TOO_LARGE',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('downloadSource — byte budget', () => {
  const hlsJob = (): TranscribeJob =>
    ({
      sources: [{ url: 'https://cdn.example/media.m3u8', kind: 'hls' }],
    }) as TranscribeJob;

  it('aborts an HLS download as soon as the running total crosses the limit', async () => {
    const segs = Array.from({ length: 6 }, (_, i) => `seg${i}.ts`).join('\n');
    let segmentFetches = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('.m3u8')) return new Response(`#EXTM3U\n${segs}\n`);
      segmentFetches++;
      return new Response(new Uint8Array(4)); // 4 bytes each: the 3rd crosses 10
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadSource(hlsJob(), ctx())).rejects.toMatchObject({
      code: 'MEDIA_TOO_LARGE',
    });
    expect(segmentFetches).toBe(3);
  });

  it('cancels a streamed body the moment it crosses the limit', async () => {
    const pulled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled();
        controller.enqueue(new Uint8Array(4));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    );
    const job = {
      sources: [{ url: 'https://cdn.example/file.mp4', kind: 'progressive' }],
    } as TranscribeJob;

    await expect(downloadSource(job, ctx())).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
    expect(pulled.mock.calls.length).toBeLessThan(6);
  });

  it('assembles HLS segments in order when within budget', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('.m3u8')) return new Response('#EXTM3U\na.ts\nb.ts\n');
      return new Response(new Uint8Array([url.endsWith('a.ts') ? 1 : 2]));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadSource(hlsJob(), ctx())).resolves.toEqual(new Uint8Array([1, 2]));
  });

  it('never downloads a lone segment as if it were the whole media', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const job = {
      sources: [
        { url: 'https://cdn.lms.example/v/seg-00412.ts', kind: 'segment' },
        { url: 'https://cdn.lms.example/v/seg-00413.ts', kind: 'segment' },
      ],
    } as TranscribeJob;
    await expect(downloadSource(job, ctx())).rejects.toMatchObject({
      code: 'MEDIA_NEEDS_PLAYBACK',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('downloadByRanges — slow links', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports progress while a block streams in, not only once it is complete', async () => {
    // One byte every 2.5 s: a block taking minutes must still look alive to
    // the worker's inactivity timer.
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 2500));
    const slowBlock = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const b of [7, 8, 9]) controller.enqueue(new Uint8Array([b]));
        controller.close();
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(partial(new Uint8Array([9]), 0, 3))
      .mockResolvedValueOnce(
        new Response(slowBlock, { status: 206, headers: { 'content-range': 'bytes 0-2/3' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const c = ctx();

    await expect(downloadByRanges(URL_GV, c)).resolves.toEqual(new Uint8Array([7, 8, 9]));
    const inBlock = c.progress.mock.calls.filter(
      (call) => (call[3] as { done: number } | undefined)?.done !== 3,
    );
    expect(inBlock.length).toBeGreaterThan(0);
    expect(inBlock[0][3]).toEqual({ done: 1, total: 3, unit: 'bytes' });
  });
});
