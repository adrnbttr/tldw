import { useEffect, useState } from 'preact/hooks';
import type { DetailLevel, DownloadFormat, Settings, Theme, TranscriptionProvider } from '@/types';
import { AVAILABLE_MODELS, DEFAULT_SETTINGS } from '@/types';
import { clearHistory, getSettings, saveSettings } from '@/storage';
import { useClearLogs, useDiagnosticCopy, useDiagnosticDownload } from '../diagnostic-actions';
import type { Locale } from '@/i18n';
import { SUPPORTED_LOCALES, LOCALE_LABELS, isLocale } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { Breadcrumb } from './Breadcrumb';
import { applyTheme } from '../theme';
import { KeyInput } from './KeyInput';
import { modelOptions } from '../model-options';

interface Props {
  onClose: () => void;
  /** Applies a UI-language change immediately across the popup. */
  onLocaleChange: (locale: Locale) => void;
  /** Replays the first-launch onboarding wizard. */
  onReplayOnboarding: () => void;
}

const DETAIL_ORDER: DetailLevel[] = ['concise', 'standard', 'detailed'];
const THEMES: Theme[] = ['system', 'light', 'dark'];
const FORMATS: DownloadFormat[] = ['pdf', 'docx'];

export function SettingsView({ onClose, onLocaleChange, onReplayOnboarding }: Props) {
  const t = useI18n();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const localeSelect = (value: Locale, onPick: (loc: Locale) => void): preact.JSX.Element => (
    <select
      value={value}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (isLocale(v)) onPick(v);
      }}
    >
      {SUPPORTED_LOCALES.map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc]}
        </option>
      ))}
    </select>
  );

  const save = async () => {
    try {
      await saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setSaveFailed(true);
      setTimeout(() => setSaveFailed(false), 1500);
    }
  };

  const { copied, failed: copyFailed, copyDiagnostic } = useDiagnosticCopy();
  const { failed: downloadFailed, download } = useDiagnosticDownload();
  const { cleared, failed: clearFailed, clear } = useClearLogs();

  // Clear history: a two-step, inline confirmation (no native dialog in the popup).
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [historyState, setHistoryState] = useState<'idle' | 'cleared' | 'failed'>('idle');
  const doClearHistory = async () => {
    setConfirmingClear(false);
    try {
      await clearHistory();
      setHistoryState('cleared');
    } catch {
      setHistoryState('failed');
    }
    setTimeout(() => setHistoryState('idle'), 1500);
  };

  // A stored model outside the list is shown as such (model-options.ts).
  const models = modelOptions(settings.summaryModel, AVAILABLE_MODELS, t.settings);

  return (
    <div class="screen">
      <header class="topbar">
        <Breadcrumb rootLabel={t.nav.videos} current={t.settings.heading} onRoot={onClose} />
      </header>

      <h2 class="settings-section">{t.settings.sectionAppearance}</h2>

      <label class="field">
        <span>{t.settings.theme}</span>
        <select
          value={settings.theme}
          onChange={(e) => {
            const th = (e.target as HTMLSelectElement).value as Theme;
            update('theme', th);
            applyTheme(th); // live preview
          }}
        >
          {THEMES.map((th) => (
            <option key={th} value={th}>
              {t.settings.themeLabels[th]}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>{t.settings.uiLanguage}</span>
        {localeSelect(settings.uiLanguage, (loc) => {
          update('uiLanguage', loc);
          onLocaleChange(loc);
        })}
      </label>

      <label class="field">
        <span>{t.settings.outputLanguage}</span>
        {localeSelect(settings.outputLanguage, (loc) => update('outputLanguage', loc))}
      </label>

      <h2 class="settings-section">{t.settings.sectionKeys}</h2>

      <label class="field">
        <span>{t.settings.openRouterKey}</span>
        <KeyInput
          value={settings.openRouterKey}
          placeholder="sk-or-…"
          onInput={(v) => update('openRouterKey', v)}
          ariaLabel={t.settings.openRouterKey}
          openRouter
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
          <KeyInput
            value={settings.transcriptionKey}
            placeholder={t.settings.transcriptionPlaceholder}
            onInput={(v) => update('transcriptionKey', v)}
            ariaLabel={t.settings.transcriptionKey}
          />
        </label>
      )}

      <h2 class="settings-section">{t.settings.sectionSummary}</h2>

      <label class="field">
        <span>{t.settings.model}</span>
        <select
          value={settings.summaryModel}
          onChange={(e) => update('summaryModel', (e.target as HTMLSelectElement).value)}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
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
        <span>{t.settings.downloadFormat}</span>
        <select
          value={settings.downloadFormat}
          onChange={(e) =>
            update('downloadFormat', (e.target as HTMLSelectElement).value as DownloadFormat)
          }
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {t.settings.formatLabels[f]}
            </option>
          ))}
        </select>
      </label>

      <h2 class="settings-section">{t.settings.sectionHistory}</h2>

      {confirmingClear ? (
        <div class="confirm-panel" role="alertdialog" aria-label={t.settings.clearHistory}>
          <p>{t.settings.clearHistoryConfirm}</p>
          <div class="actions">
            <button class="secondary danger" onClick={() => void doClearHistory()}>
              {t.settings.clearHistoryConfirmAction}
            </button>
            <button class="secondary" onClick={() => setConfirmingClear(false)}>
              {t.settings.clearHistoryCancel}
            </button>
          </div>
        </div>
      ) : (
        <div class="actions">
          <button
            class="secondary danger"
            aria-live="polite"
            onClick={() => setConfirmingClear(true)}
          >
            {historyState === 'failed'
              ? t.settings.diagnosticFailed
              : historyState === 'cleared'
                ? t.settings.historyCleared
                : t.settings.clearHistory}
          </button>
        </div>
      )}

      <h2 class="settings-section">{t.settings.sectionDiagnostic}</h2>

      <p class="settings-hint">{t.settings.diagnosticHint}</p>

      <div class="actions">
        <button class="secondary" onClick={() => void copyDiagnostic()}>
          {copyFailed
            ? t.settings.diagnosticFailed
            : copied
              ? t.result.copied
              : t.settings.diagnosticCopy}
        </button>
        <button class="secondary" onClick={() => void download()}>
          {downloadFailed ? t.settings.diagnosticFailed : t.settings.diagnosticDownload}
        </button>
        <button class="secondary danger" onClick={() => void clear()}>
          {clearFailed
            ? t.settings.diagnosticFailed
            : cleared
              ? t.settings.logsCleared
              : t.settings.diagnosticClear}
        </button>
      </div>

      <button class="primary" onClick={() => void save()} aria-live="polite">
        {saveFailed ? t.result.failed : saved ? t.settings.saved : t.settings.save}
      </button>

      <button class="link-btn" onClick={onReplayOnboarding}>
        {t.settings.replayOnboarding}
      </button>
    </div>
  );
}
