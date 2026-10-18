import { describe, expect, it } from 'vitest';
import type { MediaCandidate } from './media';
import { selectSources } from './sources';

const gv = (frameId: number, itag = 18): MediaCandidate => ({
  url: `https://rr1---sn-x.googlevideo.com/videoplayback?itag=${itag}&mime=video%2Fmp4`,
  kind: 'progressive',
  frameId,
});
const hls = (frameId: number, name = 'a'): MediaCandidate => ({
  url: `https://cdn.example/${name}.m3u8`,
  kind: 'hls',
  frameId,
});

describe('selectSources', () => {
  it("prefers a native video's own src over every capture", () => {
    const out = selectSources({ provider: 'native', mediaSrc: 'https://cdn.example/file' }, [
      hls(0),
      gv(3),
    ]);
    expect(out).toEqual({
      sources: [{ url: 'https://cdn.example/file', kind: 'progressive' }],
      attributed: true,
    });
  });

  it('uses Vimeo config sources when resolved', () => {
    const config: MediaCandidate[] = [{ url: 'https://vimeo.example/x.mp4', kind: 'progressive' }];
    const out = selectSources({ provider: 'vimeo', mediaSrc: null }, [hls(2)], config);
    expect(out).toEqual({ sources: config, attributed: true });
  });

  it('never lets a googlevideo capture serve a non-Drive video', () => {
    const out = selectSources({ provider: 'native', mediaSrc: null, frameId: 0 }, [gv(4), hls(0)]);
    expect(out.sources).toEqual([hls(0)]);
  });

  it('keeps only googlevideo-family streams for Drive when any exist', () => {
    const out = selectSources({ provider: 'drive', mediaSrc: null, frameId: 0 }, [hls(2), gv(5)]);
    expect(out).toEqual({ sources: [gv(5)], attributed: true });
  });

  it("scopes captures to the requested video's frame", () => {
    const out = selectSources({ provider: 'native', mediaSrc: null, frameId: 7 }, [
      hls(3, 'other'),
      hls(7, 'mine'),
    ]);
    expect(out).toEqual({ sources: [hls(7, 'mine')], attributed: true });
  });

  it('falls back to every capture, unattributed, when several frames captured and none match', () => {
    const out = selectSources({ provider: 'native', mediaSrc: null, frameId: 1 }, [
      hls(3, 'a'),
      hls(4, 'b'),
    ]);
    expect(out.sources).toHaveLength(2);
    expect(out.attributed).toBe(false);
  });

  it('returns nothing when no capture is eligible', () => {
    expect(selectSources({ provider: 'vimeo', mediaSrc: null }, [gv(1)])).toEqual({
      sources: [],
      attributed: false,
    });
  });

  it("does not scope to the video's frame when it only issued loose segments", () => {
    const seg: MediaCandidate = { url: 'https://cdn.example/s-1.ts', kind: 'segment', frameId: 7 };
    const out = selectSources({ provider: 'native', mediaSrc: null, frameId: 7 }, [
      seg,
      hls(3, 'other'),
    ]);
    expect(out.sources).toEqual([seg, hls(3, 'other')]);
    expect(out.attributed).toBe(false);
  });
});
