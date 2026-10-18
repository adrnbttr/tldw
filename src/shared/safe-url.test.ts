import { describe, expect, it } from 'vitest';
import { loggableUrl } from '@/background/loggable-url';
import { describeUrl } from './safe-url';

const LEAKS = [
  '1712345678',
  '%2F',
  'hmac',
  '0123abcdef',
  '203.0.113.42',
  'TOKENVALUE',
  'SIGVALUE',
  '1AbCdEfGhIjKlMnOpQrS',
  'SIGNED',
];

describe('describeUrl / loggableUrl', () => {
  it.each([
    'https://vod-adaptive-ak.vimeocdn.com/exp=1712345678~acl=%2F123%2F~hmac=0123abcdef/seg/1/chunk.m4s?x=SIGNED',
    'https://rr1.googlevideo.com/videoplayback/expire/1712345678/ei/Y/ip/203.0.113.42/sig/SIGVALUE/lsig/TOKENVALUE/id/o-ABC.mp4',
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrS/view?usp=sharing',
  ])('keeps only host and a coarse shape: %s', (url) => {
    for (const fn of [describeUrl, loggableUrl]) {
      const out = fn(url) ?? '';
      for (const leak of LEAKS) expect(out).not.toContain(leak);
      expect(out.startsWith(new URL(url).host + '/')).toBe(true);
    }
  });

  it('describes a known first segment, extension and segment count', () => {
    expect(describeUrl('https://r.googlevideo.com/videoplayback?expire=1&sig=abc')).toBe(
      'r.googlevideo.com/videoplayback (1 seg)',
    );
    expect(describeUrl('https://cdn.test/a/b/c/master.m3u8?t=1')).toBe('cdn.test/*.m3u8 (4 seg)');
    expect(describeUrl('https://drive.google.com/file/d/ID/view')).toBe(
      'drive.google.com/file (4 seg)',
    );
  });

  it('keeps a public YouTube video id, drops the query', () => {
    expect(describeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?si=SIGNED')).toBe(
      'www.youtube.com/embed/dQw4w9WgXcQ',
    );
  });

  it('does not keep a YouTube-looking id on other hosts', () => {
    expect(describeUrl('https://evil.test/embed/dQw4w9WgXcQ')).not.toContain('dQw4w9WgXcQ');
  });

  it('returns null for empty or invalid input', () => {
    expect(describeUrl(null)).toBeNull();
    expect(describeUrl('not a url')).toBeNull();
  });
});
