import type { SummaryContent, TranscriptSource } from '@/types';

/**
 * Versioned summary template (F7).
 *
 * The template is the guarantor of a constant output formalism. The LLM returns
 * structured JSON (see `SummaryContent`); this module renders it to Markdown. The
 * model never controls the layout — only the content.
 */

export interface Template {
  id: string;
  label: string;
  /** JSON schema description injected into the prompt. */
  schemaHint: string;
  render: (input: RenderInput) => string;
}

export interface RenderInput {
  title: string;
  provider: string;
  durationLabel: string;
  transcriptSource: TranscriptSource;
  isoDate: string;
  content: SummaryContent;
}

const SOURCE_LABELS: Record<TranscriptSource, string> = {
  youtube_captions: 'Sous-titres YouTube',
  vimeo_captions: 'Sous-titres Vimeo',
  audio_transcription: 'Transcription audio',
};

export function sourceLabel(source: TranscriptSource): string {
  return SOURCE_LABELS[source];
}

const defaultTemplate: Template = {
  id: 'default-v1',
  label: 'Standard',
  schemaHint: [
    'Réponds STRICTEMENT en JSON valide, sans texte autour, avec cette forme :',
    '{',
    '  "tldr": "3 à 5 lignes de synthèse",',
    '  "keyPoints": ["5 à 10 points clés"],',
    '  "sections": [{"heading": "titre de section", "body": "développement"}],',
    '  "glossary": [{"term": "terme", "definition": "définition"}],',
    '  "takeaways": ["synthèse actionnable"]',
    '}',
  ].join('\n'),
  render({ title, provider, durationLabel, transcriptSource, isoDate, content }) {
    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push('');
    lines.push(
      `**Source :** ${provider} · **Durée :** ${durationLabel} · **Extrait le :** ${isoDate}`,
    );
    lines.push(`**Méthode :** ${sourceLabel(transcriptSource)}`);
    lines.push('');
    lines.push('## En bref');
    lines.push(content.tldr.trim());
    lines.push('');
    lines.push('## Points clés');
    for (const point of content.keyPoints) lines.push(`- ${point.trim()}`);
    lines.push('');
    lines.push('## Développement');
    for (const section of content.sections) {
      lines.push(`### ${section.heading.trim()}`);
      lines.push(section.body.trim());
      lines.push('');
    }
    if (content.glossary.length > 0) {
      lines.push('## Notions et termes techniques');
      for (const { term, definition } of content.glossary) {
        lines.push(`- **${term.trim()}** — ${definition.trim()}`);
      }
      lines.push('');
    }
    lines.push('## À retenir');
    for (const item of content.takeaways) lines.push(`- ${item.trim()}`);
    lines.push('');

    return (
      lines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim() + '\n'
    );
  },
};

const TEMPLATES: Record<string, Template> = {
  [defaultTemplate.id]: defaultTemplate,
};

export function getTemplate(id: string): Template {
  return TEMPLATES[id] ?? defaultTemplate;
}

export function listTemplates(): Template[] {
  return Object.values(TEMPLATES);
}
