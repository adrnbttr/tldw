import type { DetailLevel } from './summary';
import type { Locale } from '@/i18n/types';

/**
 * Which backend transcribes the audio fallback.
 * - `openrouter`: send audio to a multimodal model via the OpenRouter key (one
 *   provider to pay — the default).
 * - `openai`: OpenAI Whisper, needs a separate OpenAI key but gives word timings.
 */
export type TranscriptionProvider = 'openrouter' | 'openai';

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
  transcriptionProvider: 'openrouter',
  audioModel: 'google/gemini-2.5-flash',
  summaryModel: 'google/gemini-2.5-flash',
  outputLanguage: 'en',
  uiLanguage: 'en',
  detailLevel: 'standard',
  templateId: 'default-v1',
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
