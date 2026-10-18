import type { JobStep } from '@/types/messages';
import type { DetailLevel } from '@/types/summary';
import type { TranscriptSource } from '@/types/transcript';
import type { TldwErrorCode } from '@/types/errors';
import type { DownloadFormat, ModelQualifier, Theme } from '@/types/settings';

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
  /** BCP 47 tag of the catalog — drives Intl number/plural formatting and `<html lang>`. */
  locale: Locale;
  /** Breadcrumb / navigation labels. */
  nav: {
    videos: string;
  };
  list: {
    historyTooltip: string;
    settingsTooltip: string;
    rescanTooltip: string;
    emptyTitle: string;
    /** What to do when no video is detected. */
    emptyHint: string;
    /** Which sites work (empty state footnote). */
    emptySites: string;
    /** Visible label of the rescan button (empty state). */
    rescan: string;
    /** Accessible label of the loading skeleton. */
    loading: string;
    noTitle: string;
    /** Badge label for a plain native <video> (YouTube/Vimeo keep their names). */
    videoLabel: string;
    untreatable: string;
    summarize: string;
    /** Error row: run the job again. */
    retry: string;
    summarizeSelection: (count: number) => string;
    summarizeAll: (count: number) => string;
    view: string;
    /** Done row: summarize again, bypassing the saved summary. */
    regenerate: string;
    /** Error row: copy the local diagnostic report for a bug report. */
    copyReport: string;
    /** Overview line, e.g. "2 videos · 1 summarized". */
    overview: (total: number, done: number) => string;
    batchProgress: (done: number, total: number) => string;
    /** Error row: jump to the settings screen (bad key, model, credits). */
    openSettings: string;
    /** Error row (insufficient credits): link to the OpenRouter credits page. */
    addCredits: string;
    /** Collapsible raw provider message under an error. */
    technicalDetails: string;
    /** Rate limit: seconds left before retrying (live countdown). */
    retryIn: (seconds: number) => string;
  };
  /** Per-video progress bar. */
  progress: {
    /** aria-label of the bar. */
    label: string;
    percent: (percent: number) => string;
    /** Running job without measured progress yet. */
    starting: string;
    captions: string;
    queued: (ahead: number) => string;
    /** Sizes in MB, already locale-formatted. */
    download: (done: string, total: string) => string;
    downloadItems: (done: number, total: number) => string;
    downloading: string;
    extracting: string;
    /** Clocks formatted "m:ss" / "h:mm:ss". */
    transcription: (done: string, total: string) => string;
    transcribing: string;
    summarizing: string;
    /** Estimated time left, in whole minutes (≥ 1), hours included past 59. */
    eta: (minutes: number) => string;
  };
  transcription: {
    fetchingMedia: string;
    extractingAudio: string;
    assembling: (index: number, total: number) => string;
    /** Range-download progress, sizes in MB, e.g. "Downloaded 8/24.6 MB". */
    downloading: (done: number, total: number) => string;
    transcribing: (index: number, total: number, clock: string) => string;
    transcribingOne: string;
    /** Audio job waiting for another one to free the transcription slot. */
    queued: string;
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
    /** Feedback when copy/download failed. */
    failed: string;
    /** Summarize again, bypassing the saved summary. */
    regenerate: string;
    /** Notice over a summary built from part of the video only. */
    partialNotice: string;
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
    /** Qualifier shown after a model's name, e.g. "(best value)". */
    modelQualifiers: Record<ModelQualifier, string>;
    /** Option for a stored model id outside the list (set by hand or by an older version). */
    customModel: (id: string) => string;
    outputLanguage: string;
    uiLanguage: string;
    detailLevel: string;
    detailLevels: Record<DetailLevel, string>;
    theme: string;
    themeLabels: Record<Theme, string>;
    /** Section headings. */
    sectionAppearance: string;
    sectionKeys: string;
    sectionSummary: string;
    downloadFormat: string;
    formatLabels: Record<DownloadFormat, string>;
    /** Diagnostic section — local report, nothing sent, no API keys inside. */
    sectionDiagnostic: string;
    diagnosticHint: string;
    diagnosticCopy: string;
    diagnosticDownload: string;
    diagnosticClear: string;
    logsCleared: string;
    /** Diagnostic action (copy / download / clear) failed. */
    diagnosticFailed: string;
    /** History section: empty the saved summaries (after a confirmation). */
    sectionHistory: string;
    clearHistory: string;
    clearHistoryConfirm: string;
    clearHistoryConfirmAction: string;
    clearHistoryCancel: string;
    historyCleared: string;
    replayOnboarding: string;
    save: string;
    saved: string;
  };
  history: {
    back: string;
    heading: string;
    empty: string;
    /** Per-entry delete button. */
    delete: string;
    /** Accessible label of the delete button, with the summary title. */
    deleteLabel: (title: string) => string;
  };
  batch: {
    back: string;
    heading: string;
    progress: (completed: number, total: number) => string;
    current: (title: string) => string;
    downloadAll: (count: number) => string;
  };
  /** API key field (onboarding + settings). */
  keyInput: {
    show: string;
    hide: string;
    /** Non-blocking hint: the pasted value does not look like an OpenRouter key. */
    invalidFormat: string;
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
