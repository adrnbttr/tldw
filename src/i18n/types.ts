import type { JobStep } from '@/types/messages';
import type { DetailLevel } from '@/types/summary';
import type { TranscriptSource } from '@/types/transcript';
import type { TldwErrorCode } from '@/types/errors';
import type { Theme } from '@/types/settings';

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
  /** Breadcrumb / navigation labels. */
  nav: {
    videos: string;
  };
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
    summarizeAll: (count: number) => string;
    view: string;
    /** Overview line, e.g. "2 videos · 1 summarized". */
    overview: (total: number, done: number) => string;
    batchProgress: (done: number, total: number) => string;
  };
  transcription: {
    fetchingMedia: string;
    extractingAudio: string;
    assembling: (index: number, total: number) => string;
    transcribing: (index: number, total: number, clock: string) => string;
    transcribingOne: string;
  };
  processing: {
    back: string;
    steps: Record<JobStep, string>;
    /** Detail shown while Gemini watches a YouTube video (can take a moment). */
    analyzingVideo: string;
    failedTitle: string;
    backToList: string;
    cancel: string;
  };
  result: {
    back: string;
    heading: string;
    method: (source: string) => string;
    length: string;
    downloadPdf: string;
    downloadWord: string;
    copy: string;
    copied: string;
  };
  settings: {
    back: string;
    heading: string;
    openRouterKey: string;
    transcriptionProvider: string;
    providerOpenRouter: string;
    providerOpenAI: string;
    transcriptionKey: string;
    transcriptionPlaceholder: string;
    model: string;
    outputLanguage: string;
    uiLanguage: string;
    detailLevel: string;
    detailLevels: Record<DetailLevel, string>;
    template: string;
    theme: string;
    themeLabels: Record<Theme, string>;
    /** Section headings. */
    sectionAppearance: string;
    sectionKeys: string;
    sectionSummary: string;
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
  onboarding: {
    next: string;
    back: string;
    skip: string;
    finish: string;
    getStarted: string;
    welcomeTitle: string;
    welcomeBody: string;
    langTitle: string;
    langBody: string;
    themeTitle: string;
    themeBody: string;
    keyTitle: string;
    keyBody: string;
    keyCost: string;
    keyGet: string;
    keyPlaceholder: string;
    keyLater: string;
    doneTitle: string;
    doneBody: string;
  };
}
