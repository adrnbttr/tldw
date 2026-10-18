import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DetectedVideo } from '@/types';
import { enrichVideos } from './enrich';

const video = (over: Partial<DetectedVideo>): DetectedVideo => ({
  id: 'v',
  provider: 'youtube',
  externalId: 'abc',
  title: null,
  duration: null,
  iframeSrc: null,
  mediaSrc: null,
  isPlaying: false,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('enrichVideos', () => {
  it('skips the YouTube oEmbed when the title is known (it never has a duration)', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const [v] = await enrichVideos([video({ externalId: 'yt-known', title: 'Known' })]);
    expect(fetch).not.toHaveBeenCalled();
    expect(v.title).toBe('Known');
  });

  it('fetches the YouTube title when missing, and the Vimeo duration', async () => {
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes('vimeo') ? { title: 'V', duration: 61 } : { title: 'Y', duration: 99 },
    }));
    vi.stubGlobal('fetch', fetch);
    const [y, v] = await enrichVideos([
      video({ externalId: 'yt-missing' }),
      video({ provider: 'vimeo', externalId: '42', title: 'Kept' }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(y).toMatchObject({ title: 'Y', duration: null });
    expect(v).toMatchObject({ title: 'Kept', duration: 61 });
  });
});
