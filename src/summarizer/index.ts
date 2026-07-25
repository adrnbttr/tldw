import type { Settings, Summary, SummaryContent, Transcript } from '@/types';
import { TldwError } from '@/types';
import { formatDuration, isoDate } from '@/shared/format';
import { chat } from './openrouter';
import { getTemplate } from './template';

/**
 * Summary generation (F7).
 *
 * The model is asked for structured JSON; Markdown is rendered locally from that
 * JSON so the output layout is identical every time, whatever the transcript path.
 *
 * Long transcripts are handled with a hierarchical strategy: split into coherent
 * blocks, summarize each block, then synthesize a final summary from the partials.
 */

/** Rough character budget per block before we switch to hierarchical mode. */
const BLOCK_CHAR_LIMIT = 24_000;

const DETAIL_HINT: Record<Settings['detailLevel'], string> = {
  concise: 'Sois concis : privilégie la densité, va à l’essentiel.',
  standard: 'Niveau de détail standard.',
  detailed: 'Sois détaillé : développe chaque section, ne perds aucun point important.',
};

export async function summarize(
  transcript: Transcript,
  settings: Settings,
  signal?: AbortSignal,
): Promise<Summary> {
  if (!settings.openRouterKey) {
    throw new TldwError('MISSING_OPENROUTER_KEY', 'OpenRouter API key is missing.');
  }

  const template = getTemplate(settings.templateId);
  const detailHint = DETAIL_HINT[settings.detailLevel];

  let sourceText = transcript.fullText;

  // Hierarchical pass for very long transcripts.
  if (sourceText.length > BLOCK_CHAR_LIMIT) {
    sourceText = await condense(sourceText, settings, signal);
  }

  const system = [
    `Tu es un assistant qui résume des vidéos pédagogiques en ${settings.outputLanguage}.`,
    detailHint,
    template.schemaHint,
  ].join('\n\n');

  const user = [
    `Titre : ${transcript.metadata.title ?? 'Vidéo sans titre'}`,
    `Langue de la transcription : ${transcript.language}`,
    '',
    'Transcription :',
    sourceText,
  ].join('\n');

  const raw = await chat({
    apiKey: settings.openRouterKey,
    model: settings.summaryModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    jsonMode: true,
    signal,
  });

  const content = parseSummaryContent(raw);

  const title = transcript.metadata.title ?? 'Vidéo sans titre';
  const durationLabel = formatDuration(transcript.duration);
  const date = isoDate();

  const markdown = template.render({
    title,
    provider: transcript.metadata.provider,
    durationLabel,
    transcriptSource: transcript.source,
    isoDate: date,
    content,
  });

  return {
    videoId: transcript.videoId,
    title,
    provider: transcript.metadata.provider,
    durationLabel,
    transcriptSource: transcript.source,
    createdAt: new Date().toISOString(),
    model: settings.summaryModel,
    content,
    markdown,
  };
}

/** Splits text into blocks, summarizes each, returns the concatenated partials. */
async function condense(text: string, settings: Settings, signal?: AbortSignal): Promise<string> {
  const blocks = splitIntoBlocks(text, BLOCK_CHAR_LIMIT);
  const partials: string[] = [];

  for (const block of blocks) {
    const partial = await chat({
      apiKey: settings.openRouterKey,
      model: settings.summaryModel,
      messages: [
        {
          role: 'system',
          content: `Résume fidèlement ce passage d'une vidéo en ${settings.outputLanguage}, en conservant tous les points importants. Texte brut, pas de mise en forme.`,
        },
        { role: 'user', content: block },
      ],
      signal,
    });
    partials.push(partial.trim());
  }

  return partials.join('\n\n');
}

/** Splits on paragraph/sentence boundaries, never mid-sentence when avoidable. */
export function splitIntoBlocks(text: string, limit: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const blocks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 > limit && current.length > 0) {
      blocks.push(current.trim());
      current = '';
    }
    current += (current ? ' ' : '') + sentence;
  }
  if (current.trim()) blocks.push(current.trim());
  return blocks;
}

/** Parses the model's JSON, tolerating code fences and stray prose. */
export function parseSummaryContent(raw: string): SummaryContent {
  const json = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TldwError('SUMMARY_API_ERROR', 'The model did not return valid JSON.');
  }

  const obj = parsed as Partial<SummaryContent>;
  return {
    tldr: typeof obj.tldr === 'string' ? obj.tldr : '',
    keyPoints: asStringArray(obj.keyPoints),
    sections: Array.isArray(obj.sections)
      ? obj.sections
          .filter((s): s is { heading: string; body: string } => !!s && typeof s === 'object')
          .map((s) => ({ heading: String(s.heading ?? ''), body: String(s.body ?? '') }))
      : [],
    glossary: Array.isArray(obj.glossary)
      ? obj.glossary
          .filter((g): g is { term: string; definition: string } => !!g && typeof g === 'object')
          .map((g) => ({ term: String(g.term ?? ''), definition: String(g.definition ?? '') }))
      : [],
    takeaways: asStringArray(obj.takeaways),
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}

function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}
