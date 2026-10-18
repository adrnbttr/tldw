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
  /** Human label of the video host, by provider id. */
  providers: Record<string, string>;
  /** Separator placed after a label: French typography wants a narrow no-break space before ':'. */
  colon: string;
  /** Title of a video whose page exposes none. */
  untitledVideo: string;
  /** Title of a YouTube video watched by URL whose page exposes none. */
  youtubeVideo: string;
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
    providers: { youtube: 'YouTube', vimeo: 'Vimeo', drive: 'Google Drive', native: 'Page video' },
    colon: ':',
    untitledVideo: 'Untitled video',
    youtubeVideo: 'YouTube video',
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
    providers: {
      youtube: 'YouTube',
      vimeo: 'Vimeo',
      drive: 'Google Drive',
      native: 'Vidéo de la page',
    },
    colon: '\u202F:',
    untitledVideo: 'Vidéo sans titre',
    youtubeVideo: 'Vidéo YouTube',
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
    providers: {
      youtube: 'YouTube',
      vimeo: 'Vimeo',
      drive: 'Google Drive',
      native: 'Vídeo de la página',
    },
    colon: ':',
    untitledVideo: 'Vídeo sin título',
    youtubeVideo: 'Vídeo de YouTube',
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
    providers: {
      youtube: 'YouTube',
      vimeo: 'Vimeo',
      drive: 'Google Drive',
      native: 'Video auf der Seite',
    },
    colon: ':',
    untitledVideo: 'Video ohne Titel',
    youtubeVideo: 'YouTube-Video',
  },
};

function strings(locale: Locale): Strings {
  return STRINGS[locale] ?? STRINGS.en;
}

/** Human label of a provider id in `locale` (English fallback; unknown ids are shown as-is). */
export function providerLabel(provider: string, locale: Locale): string {
  return strings(locale).providers[provider] ?? STRINGS.en.providers[provider] ?? provider;
}

/** Title used when the page exposes none, in the summary's output language. */
export function fallbackTitle(kind: 'untitled' | 'youtube', locale: Locale): string {
  const s = strings(locale);
  return kind === 'youtube' ? s.youtubeVideo : s.untitledVideo;
}

/**
 * Drops what the model left empty (degenerate `json_object` output): blank
 * key points and takeaways, sections with neither heading nor body, glossary
 * entries without a term; trims everything. Tolerates non-string leftovers in
 * content stored by older builds. Shared by the Markdown render and exports.
 */
export function normalizeContent(content: SummaryContent): SummaryContent {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const list = (v: unknown) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
  return {
    tldr: text(content.tldr),
    keyPoints: list(content.keyPoints),
    sections: (Array.isArray(content.sections) ? content.sections : [])
      .map((x) => ({ heading: text(x?.heading), body: text(x?.body) }))
      .filter((x) => x.heading || x.body),
    glossary: (Array.isArray(content.glossary) ? content.glossary : [])
      .map((g) => ({ term: text(g?.term), definition: text(g?.definition) }))
      .filter((g) => g.term),
    takeaways: list(content.takeaways),
  };
}

/** "Label:" with the locale's typography ("Source :" in French, with U+202F). */
export function labelled(s: Strings, label: string): string {
  return `${label}${s.colon}`;
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

/** Single set of key-point bounds, shared by SCHEMA_HINT and the length directive. */
export const KEY_POINTS_MIN = 5;
export const KEY_POINTS_MAX = 8;

export const SCHEMA_HINT = [
  'Reply STRICTLY with valid JSON, no surrounding text, in this shape:',
  '{',
  '  "tldr": "3 to 5 lines of synthesis",',
  `  "keyPoints": ["${KEY_POINTS_MIN} to ${KEY_POINTS_MAX} key points, ordered by importance, most important first"],`,
  '  "sections": [{"heading": "section title", "body": "details"}],',
  '  "glossary": [{"term": "term", "definition": "definition"}],',
  '  "takeaways": ["actionable takeaways, most important first"]',
  '}',
].join('\n');

function header(input: RenderInput, s: Strings): string[] {
  return [
    `# ${input.title}`,
    '',
    `**${labelled(s, s.source)}** ${providerLabel(input.provider, input.locale)} · **${labelled(s, s.duration)}** ${input.durationLabel} · **${labelled(s, s.extractedOn)}** ${input.isoDate}`,
    `**${labelled(s, s.method)}** ${s.sources[input.transcriptSource]}`,
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
  const content = normalizeContent(input.content);
  const parts = lengthParts(level);
  const lines: string[] = [...header(input, s)];

  // A heading is only written over actual content.
  if (content.tldr) lines.push(`## ${s.inBrief}`, content.tldr, '');
  const points = content.keyPoints.slice(0, parts.keyPoints);
  if (points.length) {
    lines.push(`## ${s.keyPoints}`);
    for (const point of points) lines.push(`- ${point}`);
    lines.push('');
  }

  if (parts.sections && content.sections.length > 0) {
    lines.push(`## ${s.development}`);
    for (const section of content.sections) {
      if (section.heading) lines.push(`### ${section.heading}`);
      if (section.body) lines.push(section.body);
      lines.push('');
    }
  }

  if (parts.glossary && content.glossary.length > 0) {
    lines.push(`## ${s.glossary}`);
    for (const { term, definition } of content.glossary) {
      lines.push(definition ? `- **${term}** — ${definition}` : `- **${term}**`);
    }
    lines.push('');
  }

  const takeaways = content.takeaways.slice(0, parts.takeaways);
  if (takeaways.length) {
    lines.push(`## ${s.toRemember}`);
    for (const item of takeaways) lines.push(`- ${item}`);
    lines.push('');
  }

  return finalize(lines);
}
