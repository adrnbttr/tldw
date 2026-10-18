import type { ModelInfo } from '@/types';
import type { Messages } from '@/i18n';

export interface ModelOption {
  id: string;
  label: string;
}

/**
 * Options of the summary-model `<select>`: the registry's models, each named
 * with its localized qualifier ("Gemini 3.1 Flash Lite (best value)") — and,
 * first, the stored model when it is not one of them (a custom id, or one an
 * older version offered), so the select shows what is actually used instead
 * of silently displaying the first option.
 */
export function modelOptions(
  current: string,
  models: readonly ModelInfo[],
  t: Pick<Messages['settings'], 'modelQualifiers' | 'customModel'>,
): ModelOption[] {
  const options = models.map((m) => ({
    id: m.id,
    label: m.qualifier ? `${m.label} (${t.modelQualifiers[m.qualifier]})` : m.label,
  }));
  if (current && !models.some((m) => m.id === current)) {
    options.unshift({ id: current, label: t.customModel(current) });
  }
  return options;
}
