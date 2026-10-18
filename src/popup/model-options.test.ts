import { describe, expect, it } from 'vitest';
import { AVAILABLE_MODELS, DEFAULT_SETTINGS } from '@/types';
import { en } from '@/i18n/en';
import { fr } from '@/i18n/fr';
import { modelOptions } from './model-options';
import { providerLabel } from './provider-label';

describe('summary model options', () => {
  it('shows a stored unknown model as a selected "custom model" option, first', () => {
    // Regression (v0.4.0 RC review): the select silently showed the first option.
    const options = modelOptions('acme/my-model', AVAILABLE_MODELS, fr.settings);
    expect(options[0]).toEqual({
      id: 'acme/my-model',
      label: 'Modèle personnalisé : acme/my-model',
    });
    expect(options).toHaveLength(AVAILABLE_MODELS.length + 1);
  });

  it('adds nothing for a model of the list', () => {
    const options = modelOptions(DEFAULT_SETTINGS.summaryModel, AVAILABLE_MODELS, en.settings);
    expect(options.map((o) => o.id)).toEqual(AVAILABLE_MODELS.map((m) => m.id));
  });

  it('localizes the qualifiers; model names stay language-neutral', () => {
    // Regression (v0.4.0 RC review): "(best value)" / "(fast)" shown in English to everyone.
    for (const m of AVAILABLE_MODELS) expect(m.label).not.toMatch(/\(/);
    const labels = modelOptions(DEFAULT_SETTINGS.summaryModel, AVAILABLE_MODELS, fr.settings).map(
      (o) => o.label,
    );
    expect(labels).toContain('Gemini 3.1 Flash Lite (meilleur rapport qualité-prix)');
    expect(labels.join(' ')).not.toMatch(/best value|highest fidelity|\(fast\)/);
  });
});

describe('provider badge', () => {
  it('is the same for the video list and the history', () => {
    expect(providerLabel('drive', 'Vidéo')).toBe('Drive');
    expect(providerLabel('youtube', 'Vidéo')).toBe('YouTube');
    expect(providerLabel('native', 'Vidéo')).toBe('Vidéo');
  });
});
