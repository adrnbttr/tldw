import type { DetectedVideo, Settings, Summary, SummaryContent, Transcript } from '@/types';
import { TldwError, YOUTUBE_VIDEO_MODEL, getModelInfo } from '@/types';
import { formatDuration, isoDate } from '@/shared/format';
import { log } from '@/background/log';
import { chat } from './openrouter';
import { fallbackTitle, renderSummary, SCHEMA_HINT, KEY_POINTS_MAX } from './template';

/** Provider that can watch a YouTube URL directly (Gemini on AI Studio). The model comes from the registry. */
const YOUTUBE_PROVIDER = { order: ['google-ai-studio'] };

/**
 * Summary generation (F7).
 *
 * The model is asked for structured JSON; Markdown is rendered locally from that
 * JSON so the output layout is identical every time, whatever the transcript path.
 *
 * Long transcripts are handled with a hierarchical strategy: split into coherent
 * blocks, summarize each block, then synthesize a final summary from the partials.
 */

/** Condense only above this share of the model's context window. */
const CONTEXT_SHARE = 0.5;
/** Rough chars-per-token ratio. */
const CHARS_PER_TOKEN = 4;
/** Threshold for models absent from the registry. */
const FALLBACK_CHAR_LIMIT = 60_000;
/** Size of one block when condensing. */
const BLOCK_CHARS = 100_000;
/** Parallel condensation calls. */
const CONDENSE_CONCURRENCY = 3;

/**
 * Transcript size (chars) above which map-reduce condensation is needed: at most
 * half of the model's context (chars ≈ tokens × 4), leaving room for the prompt
 * and the answer. Unknown model → conservative fallback.
 */
export function condenseThreshold(model: string): number {
  const info = getModelInfo(model);
  if (!info) return FALLBACK_CHAR_LIMIT;
  return Math.floor(info.contextLength * CHARS_PER_TOKEN * CONTEXT_SHARE);
}

/** Strict JSON schema of SummaryContent (for models with structured outputs). */
export const SUMMARY_JSON_SCHEMA = {
  name: 'video_summary',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['tldr', 'keyPoints', 'sections', 'glossary', 'takeaways'],
    properties: {
      tldr: { type: 'string' },
      keyPoints: { type: 'array', items: { type: 'string' } },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['heading', 'body'],
          properties: { heading: { type: 'string' }, body: { type: 'string' } },
        },
      },
      glossary: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['term', 'definition'],
          properties: { term: { type: 'string' }, definition: { type: 'string' } },
        },
      },
      takeaways: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

/** json_schema (strict) where the model supports it, json_object otherwise. */
export function responseFormatFor(model: string): {
  jsonMode: true;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
} {
  return getModelInfo(model)?.structuredOutputs
    ? { jsonMode: true, jsonSchema: SUMMARY_JSON_SCHEMA }
    : { jsonMode: true };
}

const LANGUAGE_NAMES: Record<Settings['outputLanguage'], string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
};

const THOROUGH_HINT = 'Be thorough: develop each section, do not drop any important point.';

/** Word/section budget per detail level: [min→max] scaled by duration. */
const LENGTH_BUDGET: Record<
  Settings['detailLevel'],
  { sMin: number; sMax: number; wBase: number; wCap: number }
> = {
  concise: { sMin: 2, sMax: 3, wBase: 100, wCap: 180 },
  standard: { sMin: 3, sMax: 5, wBase: 250, wCap: 400 },
  detailed: { sMin: 4, sMax: 7, wBase: 400, wCap: 700 },
};

/**
 * Hybrid length control (F7): a budget set by the detail level, nudged by the
 * video's duration within a capped range. A summary must stay scannable whatever
 * the length — the longer the video, the more it compresses.
 */
export function lengthDirective(
  level: Settings['detailLevel'],
  durationSeconds: number | null,
): string {
  const b = LENGTH_BUDGET[level];
  const minutes = durationSeconds && durationSeconds > 0 ? Math.round(durationSeconds / 60) : null;
  // 0 at ≤10 min, 1 at ≥60 min; unknown duration → mid-low default.
  const t = minutes == null ? 0.35 : Math.max(0, Math.min(1, (minutes - 10) / 50));
  const sections = Math.round(b.sMin + (b.sMax - b.sMin) * t);
  const words = Math.round(b.wBase + (b.wCap - b.wBase) * t);
  const durNote = minutes ? `This video is about ${minutes} minutes long. ` : '';
  return (
    `${durNote}A good summary stays scannable in 1–2 minutes. Target about ${words} words total, ` +
    `at most ${sections} thematic sections, up to ${KEY_POINTS_MAX} key points ordered by importance ` +
    `(most important first), up to 6 glossary terms, up to 5 takeaways. The longer the video, the MORE you compress: merge related ideas rather than adding ` +
    `sections, and never exceed these limits.`
  );
}

export async function summarize(
  transcript: Transcript,
  settings: Settings,
  signal?: AbortSignal,
): Promise<Summary> {
  if (!settings.openRouterKey) {
    throw new TldwError('MISSING_OPENROUTER_KEY', 'OpenRouter API key is missing.');
  }

  const threshold = condenseThreshold(settings.summaryModel);
  let sourceText = transcript.fullText;
  let condensed = false;

  // Hierarchical pass for very long transcripts.
  if (sourceText.length > threshold) {
    sourceText = await condense(sourceText, settings, Math.min(BLOCK_CHARS, threshold), signal);
    condensed = true;
  }

  const languageName = LANGUAGE_NAMES[settings.outputLanguage] ?? 'English';
  // Always generate the richest content; length is applied at render time so the
  // user can switch Short/Standard/Detailed instantly, with no extra model call.
  const system = [
    `You summarize educational videos. Write ALL summary content in ${languageName}.`,
    THOROUGH_HINT,
    lengthDirective('detailed', transcript.duration),
    SCHEMA_HINT,
  ].join('\n\n');

  const buildUser = (text: string): string =>
    [
      `Title: ${transcript.metadata.title ?? fallbackTitle('untitled', settings.outputLanguage)}`,
      `Transcript language: ${transcript.language}`,
      '',
      'Transcript:',
      text,
    ].join('\n');

  const call = (text: string): Promise<string> =>
    chat({
      apiKey: settings.openRouterKey,
      model: settings.summaryModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: buildUser(text) },
      ],
      ...responseFormatFor(settings.summaryModel),
      signal,
    });

  let raw: string;
  try {
    raw = await call(sourceText);
  } catch (err) {
    // The estimate was too optimistic: condense with half the threshold, once.
    if (condensed || !(err instanceof TldwError) || err.code !== 'CONTEXT_TOO_LONG') throw err;
    log.warn('context too long, retrying with condensation', { model: settings.summaryModel });
    const half = Math.floor(Math.min(threshold, sourceText.length) / 2);
    raw = await call(
      await condense(sourceText, settings, Math.min(BLOCK_CHARS, Math.max(1_000, half)), signal),
    );
  }

  const content = parseSummaryContent(raw);

  const title = transcript.metadata.title ?? fallbackTitle('untitled', settings.outputLanguage);
  const durationLabel = formatDuration(transcript.duration, settings.outputLanguage);
  const date = isoDate();

  const markdown = renderSummary(
    {
      title,
      provider: transcript.metadata.provider,
      durationLabel,
      transcriptSource: transcript.source,
      isoDate: date,
      locale: settings.outputLanguage,
      content,
    },
    settings.detailLevel,
  );

  return {
    videoId: transcript.videoId,
    title,
    provider: transcript.metadata.provider,
    durationLabel,
    transcriptSource: transcript.source,
    createdAt: new Date().toISOString(),
    locale: settings.outputLanguage,
    detailLevel: settings.detailLevel,
    model: settings.summaryModel,
    content,
    markdown,
  };
}

/**
 * Summarizes a YouTube video by letting Gemini watch it directly from its URL —
 * the reliable path now that YouTube blocks caption downloads. Uses the user's
 * OpenRouter key (routed to Google AI Studio, which accepts YouTube links).
 */
export async function summarizeYouTubeVideo(
  video: DetectedVideo,
  settings: Settings,
  signal?: AbortSignal,
): Promise<Summary> {
  if (!settings.openRouterKey) {
    throw new TldwError('MISSING_OPENROUTER_KEY', 'OpenRouter API key is missing.');
  }

  const languageName = LANGUAGE_NAMES[settings.outputLanguage] ?? 'English';
  // Always generate the richest content; length is a render-time choice.
  const system = [
    `You summarize educational videos. Write ALL summary content in ${languageName}.`,
    THOROUGH_HINT,
    lengthDirective('detailed', video.duration),
    SCHEMA_HINT,
  ].join('\n\n');

  const watchUrl = `https://www.youtube.com/watch?v=${video.externalId}`;
  const raw = await chat({
    apiKey: settings.openRouterKey,
    model: YOUTUBE_VIDEO_MODEL,
    provider: YOUTUBE_PROVIDER,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Watch this video and summarize it.' },
          { type: 'video_url', video_url: { url: watchUrl } },
        ],
      },
    ],
    ...responseFormatFor(YOUTUBE_VIDEO_MODEL),
    signal,
  });

  const content = parseSummaryContent(raw);
  const title = video.title ?? fallbackTitle('youtube', settings.outputLanguage);
  const durationLabel = formatDuration(video.duration, settings.outputLanguage);
  const markdown = renderSummary(
    {
      title,
      provider: 'youtube',
      durationLabel,
      transcriptSource: 'youtube_video',
      isoDate: isoDate(),
      locale: settings.outputLanguage,
      content,
    },
    settings.detailLevel,
  );

  return {
    videoId: video.id,
    title,
    provider: 'youtube',
    durationLabel,
    transcriptSource: 'youtube_video',
    createdAt: new Date().toISOString(),
    locale: settings.outputLanguage,
    detailLevel: settings.detailLevel,
    model: YOUTUBE_VIDEO_MODEL,
    content,
    markdown,
  };
}

/** Splits text into blocks, summarizes them (3 in parallel), returns the partials in order. */
async function condense(
  text: string,
  settings: Settings,
  blockChars: number,
  signal?: AbortSignal,
): Promise<string> {
  const blocks = splitIntoBlocks(text, blockChars);
  log.info('condensing long transcript', {
    model: settings.summaryModel,
    blocks: blocks.length,
    chars: text.length,
  });

  const partials = await mapWithConcurrency(
    blocks,
    CONDENSE_CONCURRENCY,
    async (block, index, blockSignal) => {
      log.debug('openrouter condense call', {
        model: settings.summaryModel,
        call: index + 1,
        total: blocks.length,
      });
      const partial = await chat({
        apiKey: settings.openRouterKey,
        model: settings.summaryModel,
        messages: [
          {
            role: 'system',
            content: `Faithfully summarize this passage of a video in ${LANGUAGE_NAMES[settings.outputLanguage] ?? 'English'}, keeping every important point. Plain text, no formatting.`,
          },
          { role: 'user', content: block },
        ],
        signal: blockSignal,
      });
      return partial.trim();
    },
    signal,
  );

  return partials.join('\n\n');
}

/**
 * Maps with at most `limit` tasks in flight; results keep input order. The first
 * error rejects, aborts the signal handed to in-flight tasks (they stop paying)
 * and starts no new item. An abort of `parentSignal` is propagated too.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  parentSignal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const controller = new AbortController();
  const onParentAbort = (): void => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && !controller.signal.aborted && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i, controller.signal);
      } catch (err) {
        failed = true;
        controller.abort();
        throw err;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  } finally {
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
  if (parentSignal?.aborted) throw new TldwError('CANCELLED', 'Summary aborted.');
  return results;
}

/**
 * Splits on sentence boundaries, never mid-sentence when avoidable. A sentence
 * longer than the limit (unpunctuated ASR text) is split on whitespace, and
 * hard-split when it has none.
 */
export function splitIntoBlocks(text: string, limit: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).flatMap((s) => splitLong(s, limit));
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

function splitLong(sentence: string, limit: number): string[] {
  if (sentence.length <= limit) return [sentence];
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > limit) {
    const m = /\s\S*$/.exec(rest.slice(0, limit + 1));
    const cut = m && m.index > 0 ? m.index : limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Parses the model's JSON, tolerating code fences and stray prose — and the
 * degenerate shapes the `json_object` fallback lets through: non-string items
 * (numbers/booleans are stringified, objects and null skipped), blank bullets,
 * empty sections and glossary entries are dropped. A summary with neither a
 * TL;DR nor a key point is no summary: SUMMARY_API_ERROR (retryable).
 */
export function parseSummaryContent(raw: string): SummaryContent {
  const json = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new TldwError('SUMMARY_API_ERROR', 'The model did not return valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TldwError('SUMMARY_API_ERROR', 'The model did not return a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;
  const content: SummaryContent = {
    tldr: asText(obj.tldr),
    keyPoints: asTextArray(obj.keyPoints),
    sections: asObjects(obj.sections)
      .map((s) => ({ heading: asText(s.heading), body: asText(s.body) }))
      .filter((s) => s.heading || s.body),
    glossary: asObjects(obj.glossary)
      .map((g) => ({ term: asText(g.term), definition: asText(g.definition) }))
      .filter((g) => g.term),
    takeaways: asTextArray(obj.takeaways),
  };
  if (!content.tldr && content.keyPoints.length === 0) {
    throw new TldwError(
      'SUMMARY_API_ERROR',
      'The model returned an empty summary (no TL;DR, no key point).',
    );
  }
  return content;
}

/** A trimmed string from a string, number or boolean; '' for anything else. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asText).filter(Boolean) : [];
}

function asObjects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    : [];
}

function extractJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}
