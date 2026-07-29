import type { DetailLevel } from './summary';
import type { Locale } from '@/i18n/types';

/**
 * Which backend transcribes the audio fallback.
 * - `openrouter`: send audio to a multimodal model via the OpenRouter key (one
 *   provider to pay — the default).
 * - `openai`: OpenAI Whisper, needs a separate OpenAI key but gives word timings.
 */
export type TranscriptionProvider = 'openrouter' | 'openai';

/** Popup appearance: follow the OS, or force light/dark. */
export type Theme = 'system' | 'light' | 'dark';

/** Default export format featured on a summary. */
export type DownloadFormat = 'pdf' | 'docx';

/** User preferences and secrets, stored in chrome.storage.local (F9). */
export interface Settings {
  /** OpenRouter key — summaries, and audio transcription when provider is openrouter. */
  openRouterKey: string;
  /** OpenAI key — only used when transcriptionProvider is 'openai' (Whisper). */
  transcriptionKey: string;
  /** Which backend runs the audio fallback. */
  transcriptionProvider: TranscriptionProvider;
  /** OpenRouter multimodal model used to transcribe audio (openrouter provider). */
  audioModel: string;
  /** OpenRouter model id for summaries. */
  summaryModel: string;
  /** Output language for the summary content and headings. */
  outputLanguage: Locale;
  /** Language of the extension UI. */
  uiLanguage: Locale;
  /** Popup theme (appearance). */
  theme: Theme;
  /** Export format featured as the primary action on a summary. */
  downloadFormat: DownloadFormat;
  /** Whether the first-run onboarding has been completed. */
  onboarded: boolean;
  /** Default rendered length of a summary (also the export depth). */
  detailLevel: DetailLevel;
  /** Global processing timeout for the audio fallback, in seconds. */
  timeoutSeconds: number;
  /** Max number of summaries kept in history. */
  historyLimit: number;
}

export const DEFAULT_SETTINGS: Settings = {
  openRouterKey: '',
  transcriptionKey: '',
  transcriptionProvider: 'openrouter',
  audioModel: 'google/gemini-2.5-flash',
  summaryModel: 'google/gemini-2.5-flash',
  outputLanguage: 'en',
  uiLanguage: 'en',
  theme: 'system',
  downloadFormat: 'pdf',
  onboarded: false,
  detailLevel: 'standard',
  timeoutSeconds: 15 * 60,
  historyLimit: 50,
};

/**
 * OpenRouter models surfaced in Settings (spec §3.7). Ordered best value first;
 * Gemini Flash is the default for its quality/price ratio, Claude Sonnet for
 * maximum format fidelity.
 */
export const AVAILABLE_MODELS: Array<{ id: string; label: string }> = [
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (best value)' },
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (highest fidelity)' },
];
