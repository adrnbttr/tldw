/**
 * Locale-aware number and plural helpers for the catalogs and the popup.
 *
 * Plain JS (no Preact), so the service worker and offscreen document can use
 * the catalogs that call them. Formatter instances are cached per locale.
 */

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

/** "11,8" in fr/de/es, "11.8" in en — at most `maxFractionDigits` decimals. */
export function formatNumber(locale: string, value: number, maxFractionDigits = 1): string {
  const id = `${locale}:${maxFractionDigits}`;
  let nf = numberFormats.get(id);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { maximumFractionDigits: maxFractionDigits });
    numberFormats.set(id, nf);
  }
  return nf.format(Number.isFinite(value) ? value : 0);
}

/**
 * Picks the plural form of `count` for `locale` (CLDR rules: in French 0 and 1
 * are singular, in English only 1). `other` is the fallback form.
 */
export function plural(
  locale: string,
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
): string {
  let pr = pluralRules.get(locale);
  if (!pr) {
    pr = new Intl.PluralRules(locale);
    pluralRules.set(locale, pr);
  }
  return forms[pr.select(count)] ?? forms.other;
}
