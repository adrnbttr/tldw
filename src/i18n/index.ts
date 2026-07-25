import type { Locale, Messages } from './types';
import { SUPPORTED_LOCALES } from './types';
import { en } from './en';
import { fr } from './fr';
import { es } from './es';
import { de } from './de';

export type { Locale, Messages } from './types';
export { SUPPORTED_LOCALES, LOCALE_LABELS } from './types';

// Runtime-only (no Preact here, so the service worker can import it safely).
const CATALOGS: Record<Locale, Messages> = { en, fr, es, de };

export function getCatalog(locale: Locale): Messages {
  return CATALOGS[locale] ?? en;
}

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Picks a sensible default from the browser UI language, falling back to English. */
export function detectDefaultLocale(): Locale {
  const raw =
    (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) ||
    (typeof navigator !== 'undefined' ? navigator.language : '') ||
    'en';
  const short = raw.slice(0, 2).toLowerCase();
  return isLocale(short) ? short : 'en';
}
