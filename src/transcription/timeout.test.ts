import { describe, it, expect } from 'vitest';
import { MEDIA_TIMEOUT_SECONDS, transcriptionTimeoutSeconds } from './index';

describe('transcriptionTimeoutSeconds', () => {
  it('extends the base proportionally to the duration', () => {
    expect(transcriptionTimeoutSeconds(3600, 900)).toBe(4500);
  });

  it('caps at 4 hours', () => {
    expect(transcriptionTimeoutSeconds(36000, 900)).toBe(14400);
  });

  it('falls back to the base for missing or invalid durations', () => {
    expect(transcriptionTimeoutSeconds(null, 900)).toBe(900);
    expect(transcriptionTimeoutSeconds(-5, 900)).toBe(900);
    expect(transcriptionTimeoutSeconds(Number.NaN, 900)).toBe(900);
  });

  it('ignores an invalid base', () => {
    expect(transcriptionTimeoutSeconds(600, -1)).toBe(600);
    expect(transcriptionTimeoutSeconds(null, Number.NaN)).toBe(0);
  });
});

describe('MEDIA_TIMEOUT_SECONDS', () => {
  it('is 10 minutes', () => {
    expect(MEDIA_TIMEOUT_SECONDS).toBe(600);
  });
});
