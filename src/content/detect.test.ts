import { describe, it, expect } from 'vitest';
import {
  providerFromUrl,
  externalIdFromUrl,
  dedupe,
  makeDetected,
  dropRedundantNatives,
  pageVideoFromUrl,
} from './detect';

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

describe('pageVideoFromUrl', () => {
  it('detects a youtube.com watch page', () => {
    expect(pageVideoFromUrl('https://www.youtube.com/watch?v=abc123&t=10')).toEqual({
      provider: 'youtube',
      externalId: 'abc123',
    });
  });
  it('detects youtu.be', () => {
    expect(pageVideoFromUrl('https://youtu.be/xyz')).toEqual({
      provider: 'youtube',
      externalId: 'xyz',
    });
  });
  it('detects a vimeo.com page', () => {
    expect(pageVideoFromUrl('https://vimeo.com/76979871')).toEqual({
      provider: 'vimeo',
      externalId: '76979871',
    });
  });
  it('returns null for other pages', () => {
    expect(pageVideoFromUrl('https://example.com/page')).toBeNull();
    expect(pageVideoFromUrl('https://www.youtube.com/feed/subscriptions')).toBeNull();
  });
});

describe('dropRedundantNatives', () => {
  it('drops native videos (ads) when a YouTube/Vimeo player is present', () => {
    const videos = [
      makeDetected({ provider: 'native', duration: 15 }),
      makeDetected({ provider: 'youtube', externalId: 'abc' }),
    ];
    const out = dropRedundantNatives(videos);
    expect(out).toHaveLength(1);
    expect(out[0].provider).toBe('youtube');
  });

  it('keeps native videos when there is no embed', () => {
    const videos = [makeDetected({ provider: 'native' })];
    expect(dropRedundantNatives(videos)).toHaveLength(1);
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
