import type { JobStep } from '@/types/messages';
import type { DetailLevel } from '@/types/summary';
import type { TranscriptSource } from '@/types/transcript';
import type { TldwErrorCode } from '@/types/errors';

/**
 * UI localization (i18n).
 *
 * `Messages` is the contract every locale must fully implement — TypeScript flags
 * a missing or extra key at compile time, so catalogs can never drift. Parameterized
 * strings are functions for type-safe interpolation.
 */
export const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
};

export interface Messages {
  list: {
    historyTooltip: string;
    settingsTooltip: string;
    emptyTitle: string;
    emptyHint: string;
    noTitle: string;
    /** Badge label for a plain native <video> (YouTube/Vimeo keep their names). */
    videoLabel: string;
    untreatable: string;
    summarize: string;
    summarizeSelection: (count: number) => string;
  };
  transcription: {
    fetchingMedia: string;
    extractingAudio: string;
    assembling: (index: number, total: number) => string;
    transcribing: (index: number, total: number, clock: string) => string;
  };
  processing: {
    back: string;
    steps: Record<JobStep, string>;
    failedTitle: string;
    backToList: string;
    cancel: string;
  };
  result: {
    back: string;
    heading: string;
    method: (source: string) => string;
    download: string;
    copy: string;
    copied: string;
  };
  settings: {
    back: string;
    heading: string;
    openRouterKey: string;
    transcriptionKey: string;
    transcriptionPlaceholder: string;
    model: string;
    outputLanguage: string;
    uiLanguage: string;
    detailLevel: string;
    detailLevels: Record<DetailLevel, string>;
    template: string;
    save: string;
    saved: string;
  };
  history: {
    back: string;
    heading: string;
    empty: string;
  };
  batch: {
    back: string;
    heading: string;
    progress: (completed: number, total: number) => string;
    current: (title: string) => string;
    downloadAll: (count: number) => string;
  };
  sources: Record<TranscriptSource, string>;
  errors: Record<TldwErrorCode, string>;
}
