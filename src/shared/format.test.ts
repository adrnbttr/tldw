import { describe, it, expect } from 'vitest';
import { formatDuration, slugify, isoDate } from './format';

describe('formatDuration', () => {
  it('formats hours, minutes, seconds (French)', () => {
    expect(formatDuration(3903, 'fr')).toBe('1 h 05 min 03');
    expect(formatDuration(1847, 'fr')).toBe('30 min 47');
    expect(formatDuration(12, 'fr')).toBe('12 s');
  });
  it('defaults to English', () => {
    expect(formatDuration(3903)).toBe('1 h 05 min 03');
    expect(formatDuration(null)).toBe('unknown duration');
    expect(formatDuration(3903, 'it')).toBe('1 h 05 min 03');
  });
  it('is locale-aware', () => {
    expect(formatDuration(3903, 'de')).toBe('1 Std. 05 Min. 03');
    expect(formatDuration(1847, 'de')).toBe('30 Min. 47');
    expect(formatDuration(12, 'de')).toBe('12 Sek.');
    expect(formatDuration(12, 'es')).toBe('12 s');
  });
  it('handles unknown input per locale', () => {
    expect(formatDuration(null, 'fr')).toBe('durée inconnue');
    expect(formatDuration(-1, 'fr')).toBe('durée inconnue');
    expect(formatDuration(null, 'de')).toBe('Dauer unbekannt');
    expect(formatDuration(NaN, 'es')).toBe('duración desconocida');
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
