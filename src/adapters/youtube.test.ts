import { describe, it, expect } from 'vitest';
import { extractPlayerResponse, pickTrack, parseXmlTimedtext } from './youtube';

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

describe('parseXmlTimedtext', () => {
  it('parses <text> cues and decodes entities', () => {
    const xml =
      '<transcript><text start="0" dur="4.2">Bonjour &amp; bienvenue</text>' +
      '<text start="4.2" dur="2">C&#39;est parti</text></transcript>';
    const segs = parseXmlTimedtext(xml);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ start: 0, end: 4.2, text: 'Bonjour & bienvenue' });
    expect(segs[1].text).toBe("C'est parti");
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
