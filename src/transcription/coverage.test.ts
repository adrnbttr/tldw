import { describe, expect, it } from 'vitest';
import { UNKNOWN_DURATION_SECONDS, isPartialMedia, planningDuration } from './coverage';
import { planChunks } from './chunker';
import { AUDIO_BYTES_PER_SECOND } from './audio';

describe('planningDuration', () => {
  it('never plans zero chunks for a page duration of 0 (treated as unknown)', () => {
    expect(planningDuration(0, null)).toBe(UNKNOWN_DURATION_SECONDS);
    expect(planningDuration(0, 3600)).toBe(3600);
    const chunks = planChunks({
      durationSeconds: planningDuration(0, 3600),
      bytesPerSecond: AUDIO_BYTES_PER_SECOND,
      overlapSeconds: 0,
    });
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('a page under-reporting (300 s for a 3600 s file) does not cut the plan short', () => {
    const chunks = planChunks({
      durationSeconds: planningDuration(300, 3600),
      bytesPerSecond: AUDIO_BYTES_PER_SECOND,
      overlapSeconds: 0,
    });
    expect(chunks[chunks.length - 1].end).toBe(3600);
  });

  it('ignores negative, NaN and infinite values', () => {
    expect(planningDuration(-1, Number.NaN)).toBe(UNKNOWN_DURATION_SECONDS);
    expect(planningDuration(Number.POSITIVE_INFINITY, 42)).toBe(42);
  });
});

describe('isPartialMedia', () => {
  it('flags media clearly shorter than the video (6 s of a 1 h stream)', () => {
    expect(isPartialMedia(6, 3600)).toBe(true);
  });

  it('accepts media within 80 % of the expected duration', () => {
    expect(isPartialMedia(2900, 3600)).toBe(false);
    expect(isPartialMedia(3700, 3600)).toBe(false);
  });

  it('says nothing when either side is unknown', () => {
    expect(isPartialMedia(null, 3600)).toBe(false);
    expect(isPartialMedia(6, null)).toBe(false);
    expect(isPartialMedia(6, 0)).toBe(false);
  });
});
