import { useState } from 'preact/hooks';
import { useI18n } from '@/i18n/context';
import { cleanKey, looksLikeOpenRouterKey } from '../key-format';

interface Props {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  /** Warn (without blocking) when the value does not look like an OpenRouter key. */
  openRouter?: boolean;
  /** Accessible name when the field has no wrapping <label>. */
  ariaLabel?: string;
}

/** Masked API key field with a show/hide toggle, paste clean-up and a format hint. */
export function KeyInput({ value, onInput, placeholder, openRouter, ariaLabel }: Props) {
  const t = useI18n();
  const [shown, setShown] = useState(false);
  const warn = openRouter && !looksLikeOpenRouterKey(value);
  return (
    <>
      <div class="key-input">
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={warn ? true : undefined}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellcheck={false}
          onInput={(e) => onInput(cleanKey((e.target as HTMLInputElement).value))}
        />
        <button
          type="button"
          class="key-toggle"
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? t.keyInput.hide : t.keyInput.show}
        </button>
      </div>
      {warn && (
        <span class="field-warn" role="status">
          {t.keyInput.invalidFormat}
        </span>
      )}
    </>
  );
}
