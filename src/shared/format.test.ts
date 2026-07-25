import { describe, it, expect } from 'vitest';
import { formatDuration, slugify, isoDate } from './format';

describe('formatDuration', () => {
  it('formats hours, minutes, seconds', () => {
    expect(formatDuration(3903)).toBe('1 h 05 min 03');
    expect(formatDuration(1847)).toBe('30 min 47');
    expect(formatDuration(12)).toBe('12 s');
  });
  it('handles unknown input', () => {
    expect(formatDuration(null)).toBe('durée inconnue');
    expect(formatDuration(-1)).toBe('durée inconnue');
  });
});

describe('slugify', () => {
  it('strips accents and lowercases', () => {
    expect(slugify('Résumé de la Vidéo')).toBe('resume-de-la-video');
  });
  it('falls back to "video" when empty', () => {
    expect(slugify('!!!')).toBe('video');
  });
});

describe('isoDate', () => {
  it('returns YYYY-MM-DD', () => {
    expect(isoDate(new Date('2026-07-24T10:30:00Z'))).toBe('2026-07-24');
  });
});
