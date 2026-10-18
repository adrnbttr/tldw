import { describe, expect, it } from 'vitest';
import type { DetectedVideo } from '@/types';
import { videoKey, stableVideoKey } from './video-key';

const base: DetectedVideo = {
  id: 'local-1',
  provider: 'native',
  externalId: '',
  title: null,
  duration: null,
  iframeSrc: null,
  mediaSrc: null,
  isPlaying: false,
};

describe('videoKey', () => {
  it('uses provider:externalId when the host id is known (same as the history key)', () => {
    expect(videoKey({ ...base, provider: 'drive', externalId: 'F1' })).toBe('drive:F1');
  });

  it('is stable across re-scans (fresh local ids) for a native file', () => {
    const src = 'https://cdn.example/v.mp4?sig=SECRET';
    const a = videoKey({ ...base, id: 'a', mediaSrc: src });
    const b = videoKey({ ...base, id: 'b', mediaSrc: src });
    expect(a).toBe(b);
    expect(a).not.toContain('SECRET');
    expect(a).not.toContain('cdn.example');
  });

  it('falls back to the local id', () => {
    expect(videoKey(base)).toBe('id:local-1');
  });
});

describe('stableVideoKey', () => {
  it('is null without identity and matches videoKey otherwise', () => {
    expect(stableVideoKey(base)).toBeNull();
    const v = { ...base, mediaSrc: 'https://x/a.mp4#t=3' };
    expect(stableVideoKey(v)).toBe(videoKey({ ...v, mediaSrc: 'https://x/a.mp4' }));
  });
});
