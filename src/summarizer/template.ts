import type { DetailLevel, SummaryContent, TranscriptSource } from '@/types';
import type { Locale } from '@/i18n';
import { SUPPORTED_LOCALES } from '@/i18n';

/**
 * Summary rendering (F7).
 *
 * The renderer is the guarantor of a constant output formalism. The LLM returns
 * one rich structured JSON (see `SummaryContent`); this module renders it to
 * Markdown in the chosen output language. The model never controls the layout.
 *
 * The chosen length is a *rendering* concern, not a generation one: the same JSON
 * is rendered at three depths, so switching Short/Standard/Detailed is instant and
 * free (no extra model call).
 */

export interface RenderInput {
  title: string;
  provider: string;
  durationLabel: string;
  transcriptSource: TranscriptSource;
  isoDate: string;
  locale: Locale;
  content: SummaryContent;
}

interface Strings {
  source: string;
  duration: string;
  extractedOn: string;
  method: string;
  inBrief: string;
  keyPoints: string;
  development: string;
  glossary: string;
  toRemember: string;
  sources: Record<TranscriptSource, string>;
}

/** Localized section headings and labels for the rendered Markdown. */
const STRINGS: Record<Locale, Strings> = {
  en: {
    source: 'Source',
    duration: 'Duration',
    extractedOn: 'Extracted on',
    method: 'Method',
    inBrief: 'In brief',
    keyPoints: 'Key points',
    development: 'Details',
    glossary: 'Terms & concepts',
    toRemember: 'Takeaways',
    sources: {
      youtube_captions: 'YouTube captions',
      vimeo_captions: 'Vimeo captions',
      audio_transcription: 'Audio transcription',
      youtube_video: 'YouTube video (Gemini)',
    },
  },
  fr: {
    source: 'Source',
    duration: 'Durée',
    extractedOn: 'Extrait le',
    method: 'Méthode',
    inBrief: 'En bref',
    keyPoints: 'Points clés',
    development: 'Développement',
    glossary: 'Notions et termes techniques',
    toRemember: 'À retenir',
    sources: {
      youtube_captions: 'Sous-titres YouTube',
      vimeo_captions: 'Sous-titres Vimeo',
      audio_transcription: 'Transcription audio',
      youtube_video: 'Vidéo YouTube (Gemini)',
    },
  },
  es: {
    source: 'Fuente',
    duration: 'Duración',
    extractedOn: 'Extraído el',
    method: 'Método',
    inBrief: 'En resumen',
    keyPoints: 'Puntos clave',
    development: 'Desarrollo',
    glossary: 'Nociones y términos técnicos',
    toRemember: 'Para recordar',
    sources: {
      youtube_captions: 'Subtítulos de YouTube',
      vimeo_captions: 'Subtítulos de Vimeo',
      audio_transcription: 'Transcripción de audio',
      youtube_video: 'Vídeo de YouTube (Gemini)',
    },
  },
  de: {
    source: 'Quelle',
    duration: 'Dauer',
    extractedOn: 'Extrahiert am',
    method: 'Methode',
    inBrief: 'Kurz gesagt',
    keyPoints: 'Kernpunkte',
    development: 'Ausführung',
    glossary: 'Begriffe & Konzepte',
    toRemember: 'Zum Merken',
    sources: {
      youtube_captions: 'YouTube-Untertitel',
      vimeo_captions: 'Vimeo-Untertitel',
      audio_transcription: 'Audio-Transkription',
      youtube_video: 'YouTube-Video (Gemini)',
    },
  },
};

function strings(locale: Locale): Strings {
  return STRINGS[locale] ?? STRINGS.en;
}

export type TemplateStrings = Strings;

/** Localized headings/labels for a locale — reused by the Word/PDF exports. */
export function templateStrings(locale: Locale): TemplateStrings {
  return strings(locale);
}

/**
 * Detects the language of a rendered summary from its headings — the reliable
 * source of truth for exports, even when a stored summary predates the `locale`
 * field. Falls back to English.
 */
export function detectSummaryLocale(markdown: string): Locale {
  for (const loc of SUPPORTED_LOCALES) {
    if (markdown.includes(`## ${STRINGS[loc].inBrief}`)) return loc;
  }
  return 'en';
}

export const SCHEMA_HINT = [
  'Reply STRICTLY with valid JSON, no surrounding text, in this shape:',
  '{',
  '  "tldr": "3 to 5 lines of synthesis",',
  '  "keyPoints": ["5 to 10 key points"],',
  '  "sections": [{"heading": "section title", "body": "details"}],',
  '  "glossary": [{"term": "term", "definition": "definition"}],',
  '  "takeaways": ["actionable takeaways"]',
  '}',
].join('\n');

function header(input: RenderInput, s: Strings): string[] {
  return [
    `# ${input.title}`,
    '',
    `**${s.source}:** ${input.provider} · **${s.duration}:** ${input.durationLabel} · **${s.extractedOn}:** ${input.isoDate}`,
    `**${s.method}:** ${s.sources[input.transcriptSource]}`,
    '',
  ];
}

function finalize(lines: string[]): string {
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

export interface LengthParts {
  /** Whether the Details (sections) block is shown. */
  sections: boolean;
  /** Whether the Terms & concepts (glossary) block is shown. */
  glossary: boolean;
  /** Max key points shown (Infinity = all). */
  keyPoints: number;
  /** Max takeaways shown (Infinity = all). */
  takeaways: number;
}

/**
 * What a given length renders. The rich JSON always holds everything; length gates
 * both which blocks appear *and* how many items, so the three depths are visibly
 * distinct views of one generation (shared by the on-screen render and exports).
 * - concise : brief · a few key points · a few takeaways
 * - standard: + Details (sections), more points
 * - detailed: + Terms & concepts (glossary), everything
 */
export function lengthParts(level: DetailLevel): LengthParts {
  switch (level) {
    case 'concise':
      return { sections: false, glossary: false, keyPoints: 4, takeaways: 3 };
    case 'standard':
      return { sections: true, glossary: false, keyPoints: 7, takeaways: 5 };
    default:
      return { sections: true, glossary: true, keyPoints: Infinity, takeaways: Infinity };
  }
}

/** Renders the structured summary to Markdown at the requested length. */
export function renderSummary(input: RenderInput, level: DetailLevel): string {
  const s = strings(input.locale);
  const { content } = input;
  const parts = lengthParts(level);
  const lines: string[] = [...header(input, s)];

  lines.push(`## ${s.inBrief}`, content.tldr.trim(), '');
  lines.push(`## ${s.keyPoints}`);
  for (const point of content.keyPoints.slice(0, parts.keyPoints)) lines.push(`- ${point.trim()}`);
  lines.push('');

  if (parts.sections && content.sections.length > 0) {
    lines.push(`## ${s.development}`);
    for (const section of content.sections) {
      lines.push(`### ${section.heading.trim()}`, section.body.trim(), '');
    }
  }

  if (parts.glossary && content.glossary.length > 0) {
    lines.push(`## ${s.glossary}`);
    for (const { term, definition } of content.glossary) {
      lines.push(`- **${term.trim()}** — ${definition.trim()}`);
    }
    lines.push('');
  }

  lines.push(`## ${s.toRemember}`);
  for (const item of content.takeaways.slice(0, parts.takeaways)) lines.push(`- ${item.trim()}`);
  lines.push('');

  return finalize(lines);
}
