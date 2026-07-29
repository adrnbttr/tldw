import { useState } from 'preact/hooks';
import type { Theme } from '@/types';
import type { Locale } from '@/i18n';
import { SUPPORTED_LOCALES, LOCALE_LABELS, isLocale } from '@/i18n';
import { useI18n } from '@/i18n/context';
import { saveSettings } from '@/storage';
import { applyTheme } from '../theme';

interface Props {
  /** Initial values (browser-detected languages, default theme). */
  initial: { uiLanguage: Locale; outputLanguage: Locale; theme: Theme };
  onLocaleChange: (locale: Locale) => void;
  onFinish: () => void;
}

const THEMES: Theme[] = ['system', 'light', 'dark'];
const STEPS = 5;

export function Onboarding({ initial, onLocaleChange, onFinish }: Props) {
  const t = useI18n();
  const [step, setStep] = useState(0);
  const [uiLanguage, setUiLanguage] = useState<Locale>(initial.uiLanguage);
  const [outputLanguage, setOutputLanguage] = useState<Locale>(initial.outputLanguage);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [key, setKey] = useState('');

  const pickUi = (loc: Locale) => {
    setUiLanguage(loc);
    onLocaleChange(loc); // live-translate the wizard
  };
  const pickTheme = (th: Theme) => {
    setTheme(th);
    applyTheme(th); // live preview
  };

  const finish = async () => {
    await saveSettings({
      uiLanguage,
      outputLanguage,
      theme,
      onboarded: true,
      ...(key.trim() ? { openRouterKey: key.trim() } : {}),
    });
    onFinish();
  };

  const next = () => setStep((s) => Math.min(STEPS - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div class="onboarding">
      <button class="onb-skip" onClick={() => void finish()}>
        {t.onboarding.skip}
      </button>

      <div class="onb-body">
        {step === 0 && (
          <Step icon="🎬" title={t.onboarding.welcomeTitle} body={t.onboarding.welcomeBody} />
        )}

        {step === 1 && (
          <Step icon="🌍" title={t.onboarding.langTitle} body={t.onboarding.langBody}>
            <label class="field">
              <span>{t.settings.uiLanguage}</span>
              <select
                value={uiLanguage}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  if (isLocale(v)) pickUi(v);
                }}
              >
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABELS[l]}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>{t.settings.outputLanguage}</span>
              <select
                value={outputLanguage}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  if (isLocale(v)) setOutputLanguage(v);
                }}
              >
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABELS[l]}
                  </option>
                ))}
              </select>
            </label>
          </Step>
        )}

        {step === 2 && (
          <Step icon="🎨" title={t.onboarding.themeTitle} body={t.onboarding.themeBody}>
            <div class="theme-cards">
              {THEMES.map((th) => (
                <button
                  key={th}
                  class={`theme-card ${theme === th ? 'active' : ''} theme-${th}`}
                  onClick={() => pickTheme(th)}
                >
                  <span class="theme-swatch" />
                  {t.settings.themeLabels[th]}
                </button>
              ))}
            </div>
          </Step>
        )}

        {step === 3 && (
          <Step icon="🔑" title={t.onboarding.keyTitle} body={t.onboarding.keyBody}>
            <a
              class="onb-getkey"
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
            >
              {t.onboarding.keyGet}
            </a>
            <input
              type="password"
              class="onb-key"
              value={key}
              placeholder={t.onboarding.keyPlaceholder}
              onInput={(e) => setKey((e.target as HTMLInputElement).value)}
            />
            <p class="onb-note">{t.onboarding.keyCost}</p>
            <p class="onb-note">{t.onboarding.keyLater}</p>
          </Step>
        )}

        {step === 4 && (
          <Step icon="🎉" title={t.onboarding.doneTitle} body={t.onboarding.doneBody} />
        )}
      </div>

      <div class="onb-dots">
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} class={`dot ${i === step ? 'on' : ''}`} />
        ))}
      </div>

      <div class="onb-controls">
        {step > 0 ? (
          <button class="secondary" onClick={back}>
            {t.onboarding.back}
          </button>
        ) : (
          <span />
        )}
        {step === 0 ? (
          <button class="primary" onClick={next}>
            {t.onboarding.getStarted}
          </button>
        ) : step === STEPS - 1 ? (
          <button class="primary" onClick={() => void finish()}>
            {t.onboarding.finish}
          </button>
        ) : (
          <button class="primary" onClick={next}>
            {t.onboarding.next}
          </button>
        )}
      </div>
    </div>
  );
}

function Step(props: {
  icon: string;
  title: string;
  body: string;
  children?: preact.ComponentChildren;
}) {
  return (
    <div class="onb-step">
      <div class="onb-icon">{props.icon}</div>
      <h2 class="onb-title">{props.title}</h2>
      <p class="onb-text">{props.body}</p>
      {props.children}
    </div>
  );
}
