import { describe, expect, it } from 'vitest';
import type { DetectedVideo } from '@/types';
import { isMeaningfulVideoBox } from '@/content/detect';
import { cacheKey } from '@/storage';
import { videoKey } from '@/shared/video-key';
import { mergeFrameVideos, setFrameVideos } from './frame-videos';

function vid(p: Partial<DetectedVideo> & { provider: DetectedVideo['provider'] }): DetectedVideo {
  return {
    id: Math.random().toString(36),
    externalId: '',
    title: null,
    duration: null,
    iframeSrc: null,
    mediaSrc: null,
    isPlaying: false,
    ...p,
  };
}

describe('mergeFrameVideos', () => {
  it('reports a sub-frame native video, stamped with its frame id', () => {
    const merged = mergeFrameVideos(
      new Map([
        [0, []],
        [7, [vid({ provider: 'native', mediaSrc: 'https://cdn.x/a.mp4' })]],
      ]),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].frameId).toBe(7);
  });

  it('does not clobber the top frame list and dedupes embeds seen by both frames', () => {
    const top = vid({
      provider: 'drive',
      externalId: 'F1',
      iframeSrc: 'https://drive.google.com/x',
    });
    const sub = vid({ provider: 'drive', externalId: 'F1' });
    const merged = mergeFrameVideos(
      new Map([
        [3, [sub]],
        [0, [top]],
      ]),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: top.id, frameId: 0 });
  });

  it('dedupes the same native media across frames', () => {
    const a = vid({ provider: 'native', mediaSrc: 'https://cdn.x/a.mp4' });
    const b = vid({ provider: 'native', mediaSrc: 'https://cdn.x/a.mp4' });
    expect(
      mergeFrameVideos(
        new Map([
          [1, [a]],
          [2, [b]],
        ]),
      ),
    ).toHaveLength(1);
  });

  it("keeps the page's own natives next to a YouTube/Vimeo player", () => {
    const merged = mergeFrameVideos(
      new Map([
        [
          0,
          [
            vid({ provider: 'native', mediaSrc: 'https://site/own.mp4' }),
            vid({
              provider: 'vimeo',
              externalId: '9',
              iframeSrc: 'https://player.vimeo.com/video/9',
            }),
          ],
        ],
        [2, [vid({ provider: 'native', mediaSrc: 'https://wistia/x.mp4' })]],
      ]),
    );
    expect(merged.map((v) => v.provider)).toEqual(['native', 'vimeo', 'native']);
  });

  it('replaces a hosted-player placeholder with the frame video of the same identity', () => {
    const placeholder = vid({
      provider: 'native',
      externalId: 'wistia:abc',
      iframeSrc: 'https://fast.wistia.net/embed/iframe/abc',
      title: 'Parent title',
    });
    const inside = vid({
      provider: 'native',
      externalId: 'wistia:abc',
      mediaSrc: 'https://embed.wistia.com/x.mp4',
      duration: 60,
    });
    const other = vid({ provider: 'youtube', externalId: 'y' });
    const merged = mergeFrameVideos(
      new Map([
        [0, [placeholder, other]],
        [5, [inside]],
      ]),
      // Frame 5's own URL is the Wistia player of that id.
      new Map([[5, 'wistia:abc']]),
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: inside.id, frameId: 5, title: 'Parent title' });
    expect(merged[1].provider).toBe('youtube');
  });

  it('keeps a placeholder when the player frame has no video yet', () => {
    const placeholder = vid({
      provider: 'native',
      externalId: 'loom:1',
      iframeSrc: 'https://www.loom.com/embed/1',
    });
    expect(mergeFrameVideos(new Map([[0, [placeholder]]]))).toEqual([
      { ...placeholder, frameId: 0 },
    ]);
  });

  it('keeps natives from several frames when there is no known player', () => {
    const merged = mergeFrameVideos(
      new Map([
        [0, [vid({ provider: 'native', mediaSrc: 'https://a/1.mp4' })]],
        [4, [vid({ provider: 'native', mediaSrc: 'https://b/2.mp4' })]],
      ]),
    );
    expect(merged.map((v) => v.frameId)).toEqual([0, 4]);
  });
});

describe('mergeFrameVideos — identity claimed by an unrelated frame', () => {
  // Regression (v0.4.0 RC review): an ad frame wrapping its creative in a
  // `wistia_async_<id>` container (or any DOM hint) took over the real Wistia
  // placeholder — the list showed the ad, and its summary was cached under the
  // real video's key.
  const placeholder = vid({
    provider: 'native',
    externalId: 'wistia:abc123xyz9',
    title: 'Real talk',
    iframeSrc: 'https://fast.wistia.net/embed/iframe/abc123xyz9',
  });
  const adVideo = vid({
    provider: 'native',
    externalId: 'wistia:abc123xyz9',
    title: 'Ad',
    duration: 30,
    mediaSrc: 'https://ads.evil.example/creative.mp4',
    isPlaying: true,
  });

  it('does not let a DOM-hint identity replace another frame placeholder', () => {
    const merged = mergeFrameVideos(
      new Map([
        [0, [placeholder]],
        [12, [adVideo]],
      ]),
      new Map([[12, 'adserver:#123']]),
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: placeholder.id, frameId: 0, mediaSrc: null });
    // The ad keeps only its media-URL identity: no cache/job key shared with the real video.
    expect(merged[1]).toMatchObject({ id: adVideo.id, frameId: 12, externalId: '' });
    expect(videoKey(merged[1])).not.toBe(videoKey(placeholder));
    expect(
      cacheKey('native', merged[1].externalId, 'en', { mediaSrc: merged[1].mediaSrc }),
    ).not.toBe(
      cacheKey('native', placeholder.externalId, 'en', { iframeSrc: placeholder.iframeSrc }),
    );
  });

  it('distrusts a frame that sent no identity of its own (older mirror, unknown frame)', () => {
    const merged = mergeFrameVideos(
      new Map([
        [0, [placeholder]],
        [12, [adVideo]],
      ]),
    );
    expect(merged.map((v) => v.frameId)).toEqual([0, 12]);
  });

  it('drops a DOM-hint identity in the top frame too (data-mwtitle): media URL only', () => {
    const mw = vid({ provider: 'native', externalId: 'mw:Clip.webm', mediaSrc: null });
    const [merged] = mergeFrameVideos(new Map([[0, [mw]]]), new Map());
    expect(merged.externalId).toBe('');
  });

  it('keeps hosted providers and placeholders untouched', () => {
    const yt = vid({ provider: 'youtube', externalId: 'dQw4w9WgXcQ' });
    const merged = mergeFrameVideos(new Map([[0, [placeholder, yt]]]));
    expect(merged.map((v) => v.externalId)).toEqual(['wistia:abc123xyz9', 'dQw4w9WgXcQ']);
  });
});

describe('isMeaningfulVideoBox', () => {
  it('filters tiny and invisible videos', () => {
    expect(isMeaningfulVideoBox(0, 0)).toBe(false);
    expect(isMeaningfulVideoBox(1, 1)).toBe(false);
    expect(isMeaningfulVideoBox(640, 360)).toBe(true);
  });
});

describe('setFrameVideos', () => {
  it('drops a frame entry when the frame publishes an empty list', () => {
    const frames = new Map<number, DetectedVideo[]>();
    setFrameVideos(frames, 4, [vid({ provider: 'native', mediaSrc: 'https://cdn.x/a.mp4' })]);
    expect(mergeFrameVideos(frames)).toHaveLength(1);
    setFrameVideos(frames, 4, []);
    expect(frames.has(4)).toBe(false);
    expect(mergeFrameVideos(frames)).toHaveLength(0);
  });
});
