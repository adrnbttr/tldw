import { describe, it, expect } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { es } from './es';
import { de } from './de';
import { getCatalog, isLocale, SUPPORTED_LOCALES } from './index';
import type { Messages } from './types';

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
