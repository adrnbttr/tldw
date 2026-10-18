import { describe, it, expect } from 'vitest';
import { pickTrack } from './youtube';
import { pickTrack as pickVimeo } from './vimeo';

const yt = (languageCode: string, asr = false) => ({
  baseUrl: `u-${languageCode}${asr ? '-asr' : ''}`,
  languageCode,
  ...(asr ? { kind: 'asr' } : {}),
});

describe('pickTrack (shared policy)', () => {
  it('German ASR + English manual → German (spoken language wins)', () => {
    expect(pickTrack([yt('en'), yt('de', true)], ['en']).languageCode).toBe('de');
  });

  it('prefers a manual track in the spoken language over its ASR', () => {
    expect(pickTrack([yt('de', true), yt('de'), yt('en')], ['en']).baseUrl).toBe('u-de');
  });

  it('without ASR, uses the output language', () => {
    expect(pickTrack([yt('de'), yt('fr'), yt('en')], ['fr']).languageCode).toBe('fr');
  });

  it('then manual over auto, then first', () => {
    expect(pickTrack([yt('xx', true), yt('yy')], []).languageCode).toBe('xx'); // spoken = xx
    expect(pickTrack([yt('aa'), yt('bb')], []).languageCode).toBe('aa');
  });

  it('matches regional variants by base language', () => {
    expect(pickTrack([yt('en'), yt('pt-BR')], ['pt']).languageCode).toBe('pt-BR');
  });

  it('works for Vimeo tracks too', () => {
    const track = pickVimeo(
      [
        { lang: 'en', url: '/en.vtt' },
        { lang: 'de', url: '/de.vtt' },
      ],
      ['de'],
    );
    expect(track.lang).toBe('de');
  });
});
