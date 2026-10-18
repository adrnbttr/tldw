import { describe, it, expect } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { es } from './es';
import { de } from './de';
import { getCatalog, isLocale, SUPPORTED_LOCALES } from './index';
import type { Messages } from './types';
import { formatNumber, plural } from './format';

/**
 * Every user-visible string of a catalog: string leaves as is, function leaves
 * called with sample arguments (singular and plural counts).
 */
function allStrings(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (typeof obj === 'function') {
    const fn = obj as (...args: unknown[]) => string;
    return [fn(1, 1, '0:10'), fn(3, 5, '1:02:05'), fn(75, 75, 'X')];
  }
  if (obj && typeof obj === 'object') return Object.values(obj).flatMap(allStrings);
  return [];
}

/** Recursively lists the key paths of an object (functions counted as leaves). */
function keyPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' && v !== null ? keyPaths(v, path) : [path];
  });
}

describe('i18n catalogs', () => {
  const catalogs: Record<string, Messages> = { en, fr, es, de };
  const reference = keyPaths(en).sort();

  for (const [locale, catalog] of Object.entries(catalogs)) {
    it(`${locale} has exactly the same keys as en`, () => {
      expect(keyPaths(catalog).sort()).toEqual(reference);
    });
  }

  it('covers every supported locale', () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(getCatalog(loc)).toBeDefined();
    }
  });

  it('isLocale narrows correctly', () => {
    expect(isLocale('fr')).toBe(true);
    expect(isLocale('jp')).toBe(false);
  });

  it('interpolates parameterized strings', () => {
    expect(en.list.summarizeSelection(3)).toContain('3');
    expect(de.batch.progress(2, 5)).toContain('2 / 5');
  });
});

/** Whole-word, case-insensitive match that treats accented letters as letters. */
const word = (alternatives: string) => new RegExp(`(?<!\\p{L})(${alternatives})(?!\\p{L})`, 'iu');

describe('catalog wording', () => {
  const fr_ = allStrings(fr);

  it('uses typographic apostrophes in French', () => {
    expect(fr_.filter((s) => s.includes("'"))).toEqual([]);
  });

  it('puts a narrow no-break space before French ? ! : ; and %', () => {
    // Ignore URLs and clocks ("https:", "1:02").
    const bad = fr_.filter((s) => /[^\u202F\u00A0\d][?!:;%]/.test(s.replace(/https?:/g, '')));
    expect(bad).toEqual([]);
  });

  it('avoids anglicisms and uses a single word for settings in French', () => {
    const bad = fr_.filter(
      (s) => word('jobs?|fallback|worker|logs?|supportée?s?').test(s) || /Paramètres/.test(s),
    );
    expect(bad).toEqual([]);
  });

  it('has no developer jargon in de/es/en', () => {
    for (const catalog of [de, es, en]) {
      const bad = allStrings(catalog).filter((s) => word('jobs?|fallback|worker').test(s));
      expect(bad).toEqual([]);
    }
    for (const catalog of [de, es]) {
      expect(allStrings(catalog).filter((s) => word('logs?').test(s))).toEqual([]);
    }
  });

  it('addresses the user consistently (vous / du)', () => {
    expect(fr_.filter((s) => word('tu|ton|ta|tes|toi|te').test(s))).toEqual([]);
    expect(
      allStrings(de).filter((s) => /(?<!\p{L})(Sie|Ihr|Ihre|Ihren)(?!\p{L})/u.test(s)),
    ).toEqual([]);
  });
});

describe('error wording (v0.4.0 RC review)', () => {
  it('MEDIA_PROTECTED says the server refused, suggests replaying, and limits DRM', () => {
    expect(fr.errors.MEDIA_PROTECTED).toBe(
      'Accès refusé par le serveur vidéo. Relancez la lecture de la vidéo puis réessayez. Les vidéos protégées par DRM ne sont pas prises en charge.',
    );
    for (const catalog of [en, es, de]) expect(catalog.errors.MEDIA_PROTECTED).toMatch(/DRM/);
  });

  it('a rejected transcription key names OpenAI, not OpenRouter', () => {
    for (const catalog of [en, fr, es, de]) {
      expect(catalog.errors.INVALID_TRANSCRIPTION_KEY).toMatch(/OpenAI/);
      expect(catalog.errors.INVALID_TRANSCRIPTION_KEY).not.toMatch(/OpenRouter/);
    }
  });
});

describe('format helpers', () => {
  it('formats numbers with the locale decimal separator', () => {
    expect(formatNumber('fr', 11.77)).toBe('11,8');
    expect(formatNumber('de', 941.9)).toBe('941,9');
    expect(formatNumber('en', 941.94)).toBe('941.9');
    expect(formatNumber('fr', 120)).toBe('120');
    expect(formatNumber('fr', Number.NaN)).toBe('0');
  });

  it('follows CLDR plural rules (0 and 1 singular in French)', () => {
    const forms = { one: 'vidéo', other: 'vidéos' };
    expect(plural('fr', 0, forms)).toBe('vidéo');
    expect(plural('fr', 1, forms)).toBe('vidéo');
    expect(plural('fr', 2, forms)).toBe('vidéos');
    expect(plural('en', 0, { one: 'video', other: 'videos' })).toBe('videos');
  });

  it('pluralizes the overview line', () => {
    expect(fr.list.overview(1, 1)).toBe('1 vidéo · 1 résumée');
    expect(fr.list.overview(5, 2)).toBe('5 vidéos · 2 résumées');
    expect(en.list.overview(1, 0)).toBe('1 video');
    expect(es.list.overview(2, 1)).toBe('2 vídeos · 1 resumido');
  });
});
