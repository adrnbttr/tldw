import { describe, it, expect } from 'vitest';
import { parseVtt, parseTimestamp, pickTrack } from './vimeo';

describe('parseTimestamp', () => {
  it('parses HH:MM:SS.mmm', () => {
    expect(parseTimestamp('01:02:03.500')).toBe(3723.5);
  });
  it('parses MM:SS.mmm', () => {
    expect(parseTimestamp('02:05.000')).toBe(125);
  });
});

describe('parseVtt', () => {
  it('extracts cues with timing and text', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:00.000 --> 00:00:04.200',
      'Bonjour et bienvenue.',
      '',
      '00:00:04.200 --> 00:00:07.000',
      'Voici <c>le module</c>.',
    ].join('\n');
    const segments = parseVtt(vtt);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ start: 0, end: 4.2, text: 'Bonjour et bienvenue.' });
    expect(segments[1].text).toBe('Voici le module.');
  });
});

describe('pickTrack', () => {
  it('prefers French over English', () => {
    const track = pickTrack([
      { lang: 'en', url: '/en.vtt' },
      { lang: 'fr', url: '/fr.vtt' },
    ]);
    expect(track.lang).toBe('fr');
  });
});
