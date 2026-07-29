import type { TranscriptSource } from './transcript';
import type { Locale } from '@/i18n/types';

/**
 * Structured summary content (F7).
 *
 * The LLM returns THIS JSON shape — it never controls formatting. Markdown is
 * rendered on the extension side from these fields, which guarantees a strictly
 * identical layout from one summary to the next (spec §3.7).
 */
export interface SummaryContent {
  /** "En bref" — 3 to 5 lines. */
  tldr: string;
  /** "Points clés" — 5 to 10 bullet items. */
  keyPoints: string[];
  /** "Développement" — thematic sections following the video structure. */
  sections: Array<{ heading: string; body: string }>;
  /** "Notions et termes techniques" — glossary of specialized terms. */
  glossary: Array<{ term: string; definition: string }>;
  /** "À retenir" — actionable synthesis. */
  takeaways: string[];
}

export type DetailLevel = 'concise' | 'standard' | 'detailed';

/** A fully generated summary, ready to render/store/export. */
export interface Summary {
  videoId: string;
  title: string;
  provider: string;
  /** Formatted duration string, e.g. "30 min 47". */
  durationLabel: string;
  /** Which path produced the transcript, for the "Method" line. */
  transcriptSource: TranscriptSource;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** Output language, for localizing exports (Word headings). */
  locale: Locale;
  /** Length level this summary was generated at (for the in-result switch). */
  detailLevel: DetailLevel;
  /** Model id used at OpenRouter. */
  model: string;
  content: SummaryContent;
  /** Rendered Markdown, cached so the UI and export share one source of truth. */
  markdown: string;
}
