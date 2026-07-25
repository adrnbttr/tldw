import type { DetailLevel } from './summary';
import type { Locale } from '@/i18n/types';

/** User preferences and secrets, stored in chrome.storage.local (F9). */
export interface Settings {
  /** OpenRouter key — used for summary generation only. */
  openRouterKey: string;
  /** Transcription provider key — used for the audio fallback only. */
  transcriptionKey: string;
  /** OpenRouter model id for summaries. */
  summaryModel: string;
  /** Output language for the summary content and headings. */
  outputLanguage: Locale;
  /** Language of the extension UI. */
  uiLanguage: Locale;
  detailLevel: DetailLevel;
  /** Active summary template id (versioned). */
  templateId: string;
  /** Global processing timeout for the audio fallback, in seconds. */
  timeoutSeconds: number;
  /** Max number of summaries kept in history. */
  historyLimit: number;
}

export const DEFAULT_SETTINGS: Settings = {
  openRouterKey: '',
  transcriptionKey: '',
  summaryModel: 'anthropic/claude-sonnet-4',
  outputLanguage: 'en',
  uiLanguage: 'en',
  detailLevel: 'standard',
  templateId: 'default-v1',
  timeoutSeconds: 15 * 60,
  historyLimit: 50,
};

/** OpenRouter models surfaced in Settings (spec §3.7). */
export const AVAILABLE_MODELS: Array<{ id: string; label: string }> = [
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (recommended)' },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini Flash (long transcripts)' },
];
