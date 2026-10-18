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
  /**
   * Base timeout of the transcription phase, in seconds; extended
   * proportionally to the media duration.
   */
  timeoutSeconds: number;
  /** Max number of summaries kept in history. */
  historyLimit: number;
}

/**
 * Model registry — the single source of truth, one list per role.
 *
 * Verified live against https://openrouter.ai/api/v1/models on 2026-10-18
 * (prices in USD per 1M tokens, input/output; none has an expiration_date):
 * - google/gemini-3.1-flash-lite  0.25/1.5   ctx 1,048,576  text,image,file,audio,video  structured_outputs
 * - google/gemini-3.5-flash-lite  0.30/2.5   ctx 1,048,576  text,image,file,audio,video  structured_outputs
 * - google/gemini-3.5-flash       1.50/9.0   ctx 1,048,576  text,image,file,audio,video  structured_outputs
 * - anthropic/claude-haiku-5.5    0.10/0.5   ctx 1,000,000  text,image,file              structured_outputs
 * - anthropic/claude-sonnet-5.5   2.00/10.0  ctx 1,000,000  text,image,file              structured_outputs
 * Retired: google/gemini-2.5-* (expire 2026-10-20), anthropic/claude-sonnet-4.
 */
/** Localized qualifier shown after a model's name in Settings (i18n `settings.modelQualifiers`). */
export type ModelQualifier = 'bestValue' | 'fast' | 'highestFidelity';

export interface ModelInfo {
  id: string;
  /** Model name, language-neutral (the qualifier is translated separately). */
  label: string;
  qualifier?: ModelQualifier;
  /** Context window in tokens. */
  contextLength: number;
  /** Supports response_format json_schema (strict). */
  structuredOutputs: boolean;
}

const GEMINI_CTX = 1_048_576;

/** Summary models (text in → JSON out). */
export const SUMMARY_MODELS: ModelInfo[] = [
  {
    id: 'google/gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    qualifier: 'bestValue',
    contextLength: GEMINI_CTX,
    structuredOutputs: true,
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    contextLength: GEMINI_CTX,
    structuredOutputs: true,
  },
  {
    id: 'google/gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    contextLength: GEMINI_CTX,
    structuredOutputs: true,
  },
  {
    id: 'anthropic/claude-haiku-5.5',
    label: 'Claude Haiku 5.5',
    qualifier: 'fast',
    contextLength: 1_000_000,
    structuredOutputs: true,
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    label: 'Claude Sonnet 5.5',
    qualifier: 'highestFidelity',
    contextLength: 1_000_000,
    structuredOutputs: true,
  },
];

/** Models able to take audio input (audio transcription fallback). */
export const AUDIO_MODELS: ModelInfo[] = SUMMARY_MODELS.filter((m) => m.id.startsWith('google/'));

/** Models able to take a video URL as input (YouTube direct-watch path). */
export const VIDEO_MODELS: ModelInfo[] = SUMMARY_MODELS.filter((m) => m.id.startsWith('google/'));

/** Old model id → current replacement, applied when repairing stored settings. */
export const RETIRED_MODELS: Record<string, string> = {
  'google/gemini-2.5-flash': 'google/gemini-3.1-flash-lite',
  'google/gemini-2.5-flash-lite': 'google/gemini-3.1-flash-lite',
  'google/gemini-2.5-pro': 'google/gemini-3.5-flash',
  'google/gemini-2.0-flash-001': 'google/gemini-3.1-flash-lite',
  'google/gemini-2.0-flash': 'google/gemini-3.1-flash-lite',
  'anthropic/claude-sonnet-4': 'anthropic/claude-sonnet-5.5',
  'anthropic/claude-3.5-sonnet': 'anthropic/claude-sonnet-5.5',
  'anthropic/claude-3.7-sonnet': 'anthropic/claude-sonnet-5.5',
  'anthropic/claude-3.5-haiku': 'anthropic/claude-haiku-5.5',
};

/** Registry entry for a model id, or undefined for a custom/unknown model. */
export function getModelInfo(id: string): ModelInfo | undefined {
  return SUMMARY_MODELS.find((m) => m.id === id);
}

export const DEFAULT_SETTINGS: Settings = {
  openRouterKey: '',
  transcriptionKey: '',
  transcriptionProvider: 'openrouter',
  audioModel: AUDIO_MODELS[0].id,
  summaryModel: SUMMARY_MODELS[0].id,
  outputLanguage: 'en',
  uiLanguage: 'en',
  theme: 'system',
  downloadFormat: 'pdf',
  onboarded: false,
  detailLevel: 'standard',
  timeoutSeconds: 15 * 60,
  historyLimit: 50,
};

/** Model used to watch a YouTube URL directly (needs video input). */
export const YOUTUBE_VIDEO_MODEL = VIDEO_MODELS[0].id;

/** Models surfaced in Settings (summary role). */
export const AVAILABLE_MODELS: ModelInfo[] = SUMMARY_MODELS;
