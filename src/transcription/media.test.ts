import { describe, it, expect } from 'vitest';
import { classifyMedia, isMediaUrl, pickBestCandidate, resolveSegmentUrls } from './media';

describe('classifyMedia', () => {
  it('classifies by extension', () => {
    expect(classifyMedia('https://x/y.m3u8')).toBe('hls');
    expect(classifyMedia('https://x/y.mpd?t=1')).toBe('dash');
    expect(classifyMedia('https://x/y.mp4')).toBe('progressive');
    expect(classifyMedia('https://vod-adaptive.vimeocdn.com/a/audio/123')).toBe('segment');
    expect(classifyMedia('https://x/page.html')).toBe('unknown');
  });
});

describe('isMediaUrl', () => {
  it('accepts media, rejects the rest', () => {
    expect(isMediaUrl('https://x/y.m3u8')).toBe(true);
    expect(isMediaUrl('https://x/style.css')).toBe(false);
  });
});

describe('pickBestCandidate', () => {
  it('prefers progressive over hls over segment', () => {
    const best = pickBestCandidate([
      { url: 'a', kind: 'segment' },
      { url: 'b', kind: 'hls' },
      { url: 'c', kind: 'progressive' },
    ]);
    expect(best?.url).toBe('c');
  });
  it('returns null when empty', () => {
    expect(pickBestCandidate([])).toBeNull();
  });
});

describe('resolveSegmentUrls', () => {
  it('resolves relative and absolute segment URIs', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:4.0,',
      'seg0.ts',
      '#EXTINF:4.0,',
      'https://cdn/seg1.ts',
    ].join('\n');
    const urls = resolveSegmentUrls(playlist, 'https://host/path/index.m3u8');
    expect(urls).toEqual(['https://host/path/seg0.ts', 'https://cdn/seg1.ts']);
  });
});
