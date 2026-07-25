import { describe, it, expect } from 'vitest';
import { extractPlayerResponse, pickTrack } from './youtube';

describe('extractPlayerResponse', () => {
  it('extracts the JSON blob with nested braces and strings', () => {
    const html = `<script>var ytInitialPlayerResponse = {"a":{"b":"}{"},"c":1};</script>`;
    const result = extractPlayerResponse(html);
    expect(result).toEqual({ a: { b: '}{' }, c: 1 });
  });

  it('returns null when absent', () => {
    expect(extractPlayerResponse('<html></html>')).toBeNull();
  });
});

describe('pickTrack', () => {
  it('prefers a manual French track over an automatic one', () => {
    const track = pickTrack([
      { baseUrl: 'u1', languageCode: 'fr', kind: 'asr' },
      { baseUrl: 'u2', languageCode: 'fr' },
      { baseUrl: 'u3', languageCode: 'en' },
    ]);
    expect(track.baseUrl).toBe('u2');
  });

  it('prefers preferred language over non-preferred manual', () => {
    const track = pickTrack([
      { baseUrl: 'u1', languageCode: 'de' },
      { baseUrl: 'u2', languageCode: 'fr', kind: 'asr' },
    ]);
    expect(track.baseUrl).toBe('u2');
  });
});
