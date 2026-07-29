import { useEffect, useState } from 'preact/hooks';
import type { DetailLevel, Settings, TranscriptionProvider } from '@/types';
import { AVAILABLE_MODELS, DEFAULT_SETTINGS } from '@/types';
import { getSettings, saveSettings } from '@/storage';
import { listTemplates } from '@/summarizer/template';
import type { Locale } from '@/i18n';
import { SUPPORTED_LOCALES, LOCALE_LABELS, isLocale } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { Breadcrumb } from './Breadcrumb';

interface Props {
  onClose: () => void;
  /** Applies a UI-language change immediately across the popup. */
  onLocaleChange: (locale: Locale) => void;
}

const DETAIL_ORDER: DetailLevel[] = ['concise', 'standard', 'detailed'];

export function SettingsView({ onClose, onLocaleChange }: Props) {
  const t = useI18n();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const changeUiLanguage = (value: string) => {
    if (!isLocale(value)) return;
    update('uiLanguage', value);
    onLocaleChange(value); // live preview
  };

  const save = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div class="screen">
      <header class="topbar">
        <Breadcrumb rootLabel={t.nav.videos} current={t.settings.heading} onRoot={onClose} />
      </header>

      <label class="field">
        <span>{t.settings.openRouterKey}</span>
        <input
          type="password"
          value={settings.openRouterKey}
          placeholder="sk-or-..."
          onInput={(e) => update('openRouterKey', (e.target as HTMLInputElement).value)}
        />
      </label>

      <label class="field">
        <span>{t.settings.transcriptionProvider}</span>
        <select
          value={settings.transcriptionProvider}
          onChange={(e) =>
            update(
              'transcriptionProvider',
              (e.target as HTMLSelectElement).value as TranscriptionProvider,
            )
          }
        >
          <option value="openrouter">{t.settings.providerOpenRouter}</option>
          <option value="openai">{t.settings.providerOpenAI}</option>
        </select>
      </label>

      {settings.transcriptionProvider === 'openai' && (
        <label class="field">
          <span>{t.settings.transcriptionKey}</span>
          <input
            type="password"
            value={settings.transcriptionKey}
            placeholder={t.settings.transcriptionPlaceholder}
            onInput={(e) => update('transcriptionKey', (e.target as HTMLInputElement).value)}
          />
        </label>
      )}

      <label class="field">
        <span>{t.settings.model}</span>
        <select
          value={settings.summaryModel}
          onChange={(e) => update('summaryModel', (e.target as HTMLSelectElement).value)}
        >
          {AVAILABLE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>{t.settings.uiLanguage}</span>
        <select
          value={settings.uiLanguage}
          onChange={(e) => changeUiLanguage((e.target as HTMLSelectElement).value)}
        >
          {SUPPORTED_LOCALES.map((loc) => (
            <option key={loc} value={loc}>
              {LOCALE_LABELS[loc]}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>{t.settings.outputLanguage}</span>
        <select
          value={settings.outputLanguage}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (isLocale(v)) update('outputLanguage', v);
          }}
        >
          {SUPPORTED_LOCALES.map((loc) => (
            <option key={loc} value={loc}>
              {LOCALE_LABELS[loc]}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>{t.settings.detailLevel}</span>
        <select
          value={settings.detailLevel}
          onChange={(e) =>
            update('detailLevel', (e.target as HTMLSelectElement).value as DetailLevel)
          }
        >
          {DETAIL_ORDER.map((level) => (
            <option key={level} value={level}>
              {t.settings.detailLevels[level]}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>{t.settings.template}</span>
        <select
          value={settings.templateId}
          onChange={(e) => update('templateId', (e.target as HTMLSelectElement).value)}
        >
          {listTemplates().map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.label}
            </option>
          ))}
        </select>
      </label>

      <button class="primary" onClick={() => void save()}>
        {saved ? t.settings.saved : t.settings.save}
      </button>
    </div>
  );
}
