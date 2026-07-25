import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Messages } from './types';
import { en } from './en';

/** Preact context carrying the active catalog. Popup-only (pulls in Preact). */
export const I18nContext = createContext<Messages>(en);

export function useI18n(): Messages {
  return useContext(I18nContext);
}
