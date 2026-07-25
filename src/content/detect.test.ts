import { describe, it, expect } from 'vitest';
import { providerFromUrl, externalIdFromUrl, dedupe, makeDetected } from './detect';

describe('providerFromUrl', () => {
  it('recognizes YouTube hosts', () => {
    expect(providerFromUrl('https://www.youtube.com/embed/abc123')).toBe('youtube');
    expect(providerFromUrl('https://www.youtube-nocookie.com/embed/x')).toBe('youtube');
    expect(providerFromUrl('https://youtu.be/x')).toBe('youtube');
  });
  it('recognizes Vimeo player host', () => {
    expect(providerFromUrl('https://player.vimeo.com/video/12345')).toBe('vimeo');
  });
  it('falls back to unknown', () => {
    expect(providerFromUrl('https://example.com/video')).toBe('unknown');
  });
});

describe('externalIdFromUrl', () => {
  it('extracts YouTube embed id', () => {
    expect(externalIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube')).toBe(
      'dQw4w9WgXcQ',
    );
  });
  it('extracts YouTube watch id', () => {
    expect(externalIdFromUrl('https://www.youtube.com/watch?v=abc', 'youtube')).toBe('abc');
  });
  it('extracts youtu.be id', () => {
    expect(externalIdFromUrl('https://youtu.be/xyz', 'youtube')).toBe('xyz');
  });
  it('extracts Vimeo id', () => {
    expect(externalIdFromUrl('https://player.vimeo.com/video/76979871', 'vimeo')).toBe('76979871');
  });
});

describe('dedupe', () => {
  it('removes duplicate provider+externalId', () => {
    const list = [
      makeDetected({ provider: 'youtube', externalId: 'a' }),
      makeDetected({ provider: 'youtube', externalId: 'a' }),
      makeDetected({ provider: 'youtube', externalId: 'b' }),
    ];
    expect(dedupe(list)).toHaveLength(2);
  });
});
