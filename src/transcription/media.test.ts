import { describe, it, expect } from 'vitest';
import {
  classifyMedia,
  isMediaUrl,
  pickBestCandidate,
  resolveSegmentUrls,
  isHlsMaster,
  pickHlsVariant,
  parseHlsMedia,
} from './media';

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

describe('parseHlsMedia', () => {
  it('extracts the fMP4 init segment and media fragments', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:4.0,',
      'seg0.m4s',
      '#EXTINF:4.0,',
      'seg1.m4s',
    ].join('\n');
    const { initUrl, segmentUrls } = parseHlsMedia(playlist, 'https://h/a/audio.m3u8');
    expect(initUrl).toBe('https://h/a/init.mp4');
    expect(segmentUrls).toEqual(['https://h/a/seg0.m4s', 'https://h/a/seg1.m4s']);
  });

  it('returns null init for plain TS segments', () => {
    const { initUrl, segmentUrls } = parseHlsMedia('#EXTM3U\nseg.ts', 'https://h/x.m3u8');
    expect(initUrl).toBeNull();
    expect(segmentUrls).toEqual(['https://h/seg.ts']);
  });
});

describe('HLS master handling', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="audio/aud.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000',
    'video/hi.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=500000',
    'video/lo.m3u8',
  ].join('\n');

  it('detects a master playlist', () => {
    expect(isHlsMaster(master)).toBe(true);
    expect(isHlsMaster('#EXTM3U\n#EXT-X-MAP:URI="i.mp4"\nseg.m4s')).toBe(false);
  });

  it('prefers the audio rendition', () => {
    expect(pickHlsVariant(master, 'https://h/master.m3u8')).toBe('https://h/audio/aud.m3u8');
  });

  it('falls back to the lowest-bandwidth variant when no audio track', () => {
    const noAudio = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000',
      'hi.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=500000',
      'lo.m3u8',
    ].join('\n');
    expect(pickHlsVariant(noAudio, 'https://h/master.m3u8')).toBe('https://h/lo.m3u8');
  });
});
