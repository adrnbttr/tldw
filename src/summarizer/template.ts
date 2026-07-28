import type { SummaryContent, TranscriptSource } from '@/types';
import type { Locale } from '@/i18n';
import { SUPPORTED_LOCALES } from '@/i18n';

/**
 * Versioned summary template (F7).
 *
 * The template is the guarantor of a constant output formalism. The LLM returns
 * structured JSON (see `SummaryContent`); this module renders it to Markdown in the
 * chosen output language. The model never controls the layout — only the content.
 */

export interface Template {
  id: string;
  label: string;
  /** JSON schema description injected into the prompt (English, model-facing). */
  schemaHint: string;
  render: (input: RenderInput) => string;
}

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

const SCHEMA_HINT = [
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

const defaultTemplate: Template = {
  id: 'default-v1',
  label: 'Standard',
  schemaHint: SCHEMA_HINT,
  render(input) {
    const s = strings(input.locale);
    const { content } = input;
    const lines: string[] = [...header(input, s)];

    lines.push(`## ${s.inBrief}`, content.tldr.trim(), '');
    lines.push(`## ${s.keyPoints}`);
    for (const point of content.keyPoints) lines.push(`- ${point.trim()}`);
    lines.push('', `## ${s.development}`);
    for (const section of content.sections) {
      lines.push(`### ${section.heading.trim()}`, section.body.trim(), '');
    }
    if (content.glossary.length > 0) {
      lines.push(`## ${s.glossary}`);
      for (const { term, definition } of content.glossary) {
        lines.push(`- **${term.trim()}** — ${definition.trim()}`);
      }
      lines.push('');
    }
    lines.push(`## ${s.toRemember}`);
    for (const item of content.takeaways) lines.push(`- ${item.trim()}`);
    lines.push('');

    return finalize(lines);
  },
};

/**
 * Compact template — same structured JSON input, but renders only the essentials
 * (In brief · Key points · Takeaways). Useful for quick scanning.
 */
const compactTemplate: Template = {
  id: 'compact-v1',
  label: 'Compact',
  schemaHint: SCHEMA_HINT,
  render(input) {
    const s = strings(input.locale);
    const { content } = input;
    const lines: string[] = [...header(input, s)];

    lines.push(`## ${s.inBrief}`, content.tldr.trim(), '');
    lines.push(`## ${s.keyPoints}`);
    for (const point of content.keyPoints) lines.push(`- ${point.trim()}`);
    lines.push('', `## ${s.toRemember}`);
    for (const item of content.takeaways) lines.push(`- ${item.trim()}`);
    lines.push('');

    return finalize(lines);
  },
};

const TEMPLATES: Record<string, Template> = {
  [defaultTemplate.id]: defaultTemplate,
  [compactTemplate.id]: compactTemplate,
};

export function getTemplate(id: string): Template {
  return TEMPLATES[id] ?? defaultTemplate;
}

export function listTemplates(): Template[] {
  return Object.values(TEMPLATES);
}
