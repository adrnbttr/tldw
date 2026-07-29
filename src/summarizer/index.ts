import type { DetectedVideo, Settings, Summary, SummaryContent, Transcript } from '@/types';
import { TldwError } from '@/types';
import { formatDuration, isoDate } from '@/shared/format';
import { chat } from './openrouter';
import { getTemplate } from './template';

/** Model + provider that can watch a YouTube URL directly (Gemini on AI Studio). */
const YOUTUBE_VIDEO_MODEL = 'google/gemini-2.5-flash';
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

/** Rough character budget per block before we switch to hierarchical mode. */
const BLOCK_CHAR_LIMIT = 24_000;

const LANGUAGE_NAMES: Record<Settings['outputLanguage'], string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
};

const DETAIL_HINT: Record<Settings['detailLevel'], string> = {
  concise: 'Be concise: favor density, get to the essentials.',
  standard: 'Standard level of detail.',
  detailed: 'Be thorough: develop each section, do not drop any important point.',
};

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
    `at most ${sections} thematic sections, up to 8 key points, up to 6 glossary terms, up to 5 ` +
    `takeaways. The longer the video, the MORE you compress: merge related ideas rather than adding ` +
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

  const template = getTemplate(settings.templateId);
  const detailHint = DETAIL_HINT[settings.detailLevel];

  let sourceText = transcript.fullText;

  // Hierarchical pass for very long transcripts.
  if (sourceText.length > BLOCK_CHAR_LIMIT) {
    sourceText = await condense(sourceText, settings, signal);
  }

  const languageName = LANGUAGE_NAMES[settings.outputLanguage] ?? 'English';
  const system = [
    `You summarize educational videos. Write ALL summary content in ${languageName}.`,
    detailHint,
    lengthDirective(settings.detailLevel, transcript.duration),
    template.schemaHint,
  ].join('\n\n');

  const user = [
    `Title: ${transcript.metadata.title ?? 'Untitled video'}`,
    `Transcript language: ${transcript.language}`,
    '',
    'Transcript:',
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

  const title = transcript.metadata.title ?? 'Untitled video';
  const durationLabel = formatDuration(transcript.duration);
  const date = isoDate();

  const markdown = template.render({
    title,
    provider: transcript.metadata.provider,
    durationLabel,
    transcriptSource: transcript.source,
    isoDate: date,
    locale: settings.outputLanguage,
    content,
  });

  return {
    videoId: transcript.videoId,
    title,
    provider: transcript.metadata.provider,
    durationLabel,
    transcriptSource: transcript.source,
    createdAt: new Date().toISOString(),
    locale: settings.outputLanguage,
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

  const template = getTemplate(settings.templateId);
  const languageName = LANGUAGE_NAMES[settings.outputLanguage] ?? 'English';
  const system = [
    `You summarize educational videos. Write ALL summary content in ${languageName}.`,
    DETAIL_HINT[settings.detailLevel],
    lengthDirective(settings.detailLevel, video.duration),
    template.schemaHint,
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
    jsonMode: true,
    signal,
  });

  const content = parseSummaryContent(raw);
  const title = video.title ?? 'YouTube video';
  const durationLabel = formatDuration(video.duration);
  const markdown = template.render({
    title,
    provider: 'youtube',
    durationLabel,
    transcriptSource: 'youtube_video',
    isoDate: isoDate(),
    locale: settings.outputLanguage,
    content,
  });

  return {
    videoId: video.id,
    title,
    provider: 'youtube',
    durationLabel,
    transcriptSource: 'youtube_video',
    createdAt: new Date().toISOString(),
    locale: settings.outputLanguage,
    model: YOUTUBE_VIDEO_MODEL,
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
          content: `Faithfully summarize this passage of a video in ${LANGUAGE_NAMES[settings.outputLanguage] ?? 'English'}, keeping every important point. Plain text, no formatting.`,
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
