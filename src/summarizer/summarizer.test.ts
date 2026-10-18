import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarize, summarizeYouTubeVideo } from './index';
import { resetSchemaFallback } from './openrouter';
import { classifyHttpError } from '@/shared/http-error';
import type { DetailLevel } from '@/types';
import {
  parseSummaryContent,
  splitIntoBlocks,
  lengthDirective,
  condenseThreshold,
  responseFormatFor,
  mapWithConcurrency,
} from './index';
import { SCHEMA_HINT, KEY_POINTS_MIN, KEY_POINTS_MAX } from './template';
import type { TranscriptSource } from '@/types';
import { DEFAULT_SETTINGS, YOUTUBE_VIDEO_MODEL, VIDEO_MODELS } from '@/types';
import { renderSummary, lengthParts, detectSummaryLocale } from './template';

const sampleContent = {
  tldr: 'En bref.',
  keyPoints: ['Point 1', 'Point 2'],
  sections: [{ heading: 'Intro', body: 'Corps.' }],
  glossary: [{ term: 'Terme', definition: 'Déf.' }],
  takeaways: ['À retenir.'],
};

const render = (level: DetailLevel, locale: 'fr' | 'en' | 'de' = 'fr') =>
  renderSummary(
    {
      title: 'Titre',
      provider: 'youtube',
      durationLabel: '30 min 47',
      transcriptSource: 'youtube_captions',
      isoDate: '2026-07-24',
      locale,
      content: sampleContent,
    },
    level,
  );

describe('parseSummaryContent', () => {
  it('parses raw JSON', () => {
    const content = parseSummaryContent(
      '{"tldr":"x","keyPoints":["a","b"],"sections":[],"glossary":[],"takeaways":["t"]}',
    );
    expect(content.tldr).toBe('x');
    expect(content.keyPoints).toEqual(['a', 'b']);
    expect(content.takeaways).toEqual(['t']);
  });

  it('tolerates code fences', () => {
    const content = parseSummaryContent('```json\n{"tldr":"y"}\n```');
    expect(content.tldr).toBe('y');
    expect(content.keyPoints).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseSummaryContent('not json at all')).toThrow();
  });

  // Regression (v0.4.0 RC review): degenerate json_object output rendered
  // "### null", empty bullets and empty headings.
  it('drops empty and non-string items from degenerate model output', () => {
    const content = parseSummaryContent(
      '```json\n{"tldr":" ","keyPoints":["a", "", null, {"x":1}, 3],"sections":[{"heading":null,"body":null},{"heading":"H","body":""},null],"glossary":[{"term":null},{"term":"T","definition":null}],"takeaways":[{"a":1}," t "]}\n```',
    );
    expect(content).toEqual({
      tldr: '',
      keyPoints: ['a', '3'],
      sections: [{ heading: 'H', body: '' }],
      glossary: [{ term: 'T', definition: '' }],
      takeaways: ['t'],
    });
  });

  it('rejects a summary with neither TL;DR nor key point (retryable SUMMARY_API_ERROR)', () => {
    expect(() =>
      parseSummaryContent(
        '{"tldr":"","keyPoints":[],"sections":[{"heading":null,"body":null}],"glossary":[{"term":null}],"takeaways":[{"a":1}]}',
      ),
    ).toThrow(expect.objectContaining({ code: 'SUMMARY_API_ERROR' }));
    expect(() => parseSummaryContent('[1,2]')).toThrow(
      expect.objectContaining({ code: 'SUMMARY_API_ERROR' }),
    );
  });

  it('renders no heading over empty content', () => {
    const md = renderSummary(
      {
        title: 'X',
        provider: 'native',
        durationLabel: '—',
        transcriptSource: 'audio_transcription',
        isoDate: '2026-10-18',
        locale: 'fr',
        content: {
          tldr: '',
          keyPoints: ['Un point.'],
          sections: [
            { heading: '', body: '' },
            { heading: '', body: 'Corps seul.' },
          ],
          glossary: [{ term: '', definition: 'orpheline' }],
          takeaways: [],
        },
      },
      'detailed',
    );
    expect(md).not.toContain('## En bref');
    expect(md).not.toContain('## À retenir');
    expect(md).not.toContain('## Notions');
    expect(md).not.toMatch(/^###\s*$/m);
    expect(md).not.toMatch(/^-\s*$/m);
    expect(md).toContain('## Points clés\n- Un point.');
    expect(md).toContain('## Développement\nCorps seul.');
  });
});

describe('splitIntoBlocks', () => {
  it('keeps blocks under the limit', () => {
    const text = Array.from({ length: 50 }, (_, i) => `Phrase ${i}.`).join(' ');
    const blocks = splitIntoBlocks(text, 60);
    expect(blocks.length).toBeGreaterThan(1);
    for (const b of blocks) expect(b.length).toBeLessThanOrEqual(70);
  });
});

describe('summary rendering', () => {
  it('produces a stable Markdown structure at the detailed length', () => {
    const md = render('detailed');
    expect(md).toContain('# Titre');
    expect(md).toContain('## En bref');
    expect(md).toContain('## Points clés');
    expect(md).toContain('**Méthode\u202F:** Sous-titres YouTube');
    expect(md).toContain('- **Terme** — Déf.');
  });

  it('scales the length budget by duration, capped by detail level', () => {
    const short = lengthDirective('standard', 10 * 60); // 10 min → low end
    const long = lengthDirective('standard', 60 * 60); // 60 min → cap
    expect(short).toContain('3 thematic sections');
    expect(short).toContain('250 words');
    expect(long).toContain('5 thematic sections');
    expect(long).toContain('400 words');
    // Never balloons: concise stays small even for a very long video.
    expect(lengthDirective('concise', 120 * 60)).toContain('3 thematic sections');
    expect(long).toContain('the MORE you compress');
  });

  it('detects the summary language from its headings', () => {
    expect(detectSummaryLocale('# T\n\n## En bref\nx')).toBe('fr');
    expect(detectSummaryLocale('# T\n\n## In brief\nx')).toBe('en');
    expect(detectSummaryLocale('# T\n\n## Kurz gesagt\nx')).toBe('de');
    expect(detectSummaryLocale('# T\n\n## En resumen\nx')).toBe('es');
    expect(detectSummaryLocale('no headings here')).toBe('en');
  });

  it('localizes headings by output language', () => {
    expect(render('detailed', 'en')).toContain('## In brief');
    expect(render('detailed', 'de')).toContain('## Kurz gesagt');
  });

  it('gates blocks and item counts by length', () => {
    expect(lengthParts('concise')).toEqual({
      sections: false,
      glossary: false,
      keyPoints: 4,
      takeaways: 3,
    });
    expect(lengthParts('standard')).toEqual({
      sections: true,
      glossary: false,
      keyPoints: 7,
      takeaways: 5,
    });
    expect(lengthParts('detailed')).toEqual({
      sections: true,
      glossary: true,
      keyPoints: Infinity,
      takeaways: Infinity,
    });
  });

  it('concise omits Développement and glossary', () => {
    const md = render('concise');
    expect(md).toContain('## En bref');
    expect(md).toContain('## À retenir');
    expect(md).not.toContain('## Développement');
    expect(md).not.toContain('## Notions');
  });

  it('caps key points at the concise length', () => {
    const many = {
      ...sampleContent,
      keyPoints: ['a', 'b', 'c', 'd', 'e', 'f'],
    };
    const md = renderSummary(
      {
        title: 'T',
        provider: 'youtube',
        durationLabel: '5 min',
        transcriptSource: 'youtube_captions',
        isoDate: '2026-07-24',
        locale: 'fr',
        content: many,
      },
      'concise',
    );
    // concise caps at 4 key points.
    expect((md.match(/^- [a-f]$/gm) ?? []).length).toBe(4);
  });

  it('standard keeps Développement but drops the glossary', () => {
    const md = render('standard');
    expect(md).toContain('## Développement');
    expect(md).not.toContain('## Notions');
  });
});

describe('model-aware condensation', () => {
  it('a 1h transcript (~51k chars) is not condensed on a 1M-context model', () => {
    expect(condenseThreshold(DEFAULT_SETTINGS.summaryModel)).toBeGreaterThan(51_000);
    expect(condenseThreshold('google/gemini-3.1-flash-lite')).toBe(Math.floor(1_048_576 * 2));
  });
  it('unknown models use the conservative 60k-char fallback', () => {
    expect(condenseThreshold('foo/bar')).toBe(60_000);
  });
});

describe('response format', () => {
  it('uses strict json_schema for registry models, json_object otherwise', () => {
    expect(responseFormatFor(DEFAULT_SETTINGS.summaryModel).jsonSchema?.name).toBe('video_summary');
    expect(responseFormatFor('foo/bar')).toEqual({ jsonMode: true });
  });
  it('video model comes from the registry', () => {
    expect(VIDEO_MODELS.map((m) => m.id)).toContain(YOUTUBE_VIDEO_MODEL);
  });
});

describe('mapWithConcurrency', () => {
  it('limits parallelism to 3 and preserves order', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
  it('rejects on the first error', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 3, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});

describe('prompt consistency', () => {
  it('uses one set of key-point bounds, ordered by importance', () => {
    expect(SCHEMA_HINT).toContain(`${KEY_POINTS_MIN} to ${KEY_POINTS_MAX} key points`);
    expect(SCHEMA_HINT).toContain('most important first');
    const d = lengthDirective('detailed', 1800);
    expect(d).toContain(`up to ${KEY_POINTS_MAX} key points`);
    expect(d).toContain('most important first');
  });
});

describe('regressions (final review)', () => {
  const transcript = (text: string) =>
    ({
      videoId: 'v',
      fullText: text,
      language: 'en',
      duration: 600,
      source: 'captions',
      segments: [],
      metadata: { title: 'T', provider: 'youtube' },
    }) as never;
  const settings = { ...DEFAULT_SETTINGS, openRouterKey: 'k' };
  const okBody = JSON.stringify({
    choices: [
      {
        message: {
          content: '{"tldr":"x","keyPoints":[],"sections":[],"glossary":[],"takeaways":[]}',
        },
      },
    ],
  });

  beforeEach(() => {
    resetSchemaFallback();
    vi.unstubAllGlobals();
  });

  it('classifies a response_format 400 as non-MODEL_UNAVAILABLE', () => {
    expect(
      classifyHttpError(
        400,
        'Invalid schema for response_format: model does not support structured outputs',
      ),
    ).not.toBe('MODEL_UNAVAILABLE');
  });

  it('retries once with json_object when json_schema is rejected, and remembers it', async () => {
    const formats: Array<string | undefined> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        formats.push(body.response_format?.type);
        return body.response_format?.type === 'json_schema'
          ? new Response('{"error":{"message":"response_format json_schema is not supported"}}', {
              status: 400,
            })
          : new Response(okBody, { status: 200 });
      }),
    );
    await summarize(transcript('hello.'), settings);
    expect(formats).toEqual(['json_schema', 'json_object']);
    await summarize(transcript('hello.'), settings);
    expect(formats).toEqual(['json_schema', 'json_object', 'json_object']);
  });

  it('splits unpunctuated text on whitespace and hard-splits without whitespace', () => {
    const words = Array.from({ length: 6000 }, (_, i) => 'word' + i).join(' ');
    const blocks = splitIntoBlocks(words, 10_000);
    expect(blocks.length).toBeGreaterThan(1);
    expect(Math.max(...blocks.map((b) => b.length))).toBeLessThanOrEqual(10_000);
    expect(blocks.join(' ')).toBe(words);
    const solid = splitIntoBlocks('x'.repeat(25_000), 10_000);
    expect(solid.map((b) => b.length)).toEqual([10_000, 10_000, 5_000]);
  });

  it('retries via condensation, once, on CONTEXT_TOO_LONG from a single-shot call', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return calls === 1
          ? new Response('maximum context length exceeded', { status: 400 })
          : new Response(okBody, { status: 200 });
      }),
    );
    const text = 'Une phrase. '.repeat(1000); // 12k chars, under the threshold
    const out = await summarize(transcript(text), settings);
    expect(out.content.tldr).toBe('x');
    expect(calls).toBeGreaterThanOrEqual(3); // failed call + condensation block(s) + final
  });

  it('mapWithConcurrency aborts in-flight siblings and starts nothing after a failure', async () => {
    const started: number[] = [];
    const aborted: number[] = [];
    const p = mapWithConcurrency([0, 1, 2, 3, 4], 3, async (i, _idx, signal) => {
      started.push(i);
      if (i === 0) {
        await new Promise((r) => setTimeout(r, 5));
        throw new Error('boom');
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 50);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          aborted.push(i);
          resolve();
        });
      });
      return i;
    });
    await expect(p).rejects.toThrow('boom');
    expect(aborted.sort()).toEqual([1, 2]);
    expect(started).toEqual([0, 1, 2]);
  });

  it('a caller abort surfaces as CANCELLED, not TIMEOUT', async () => {
    const ac = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        ac.abort();
        throw new DOMException('aborted', 'AbortError');
      }),
    );
    const err = await summarize(transcript('hello.'), settings, ac.signal).catch((e) => e);
    expect(err.code).toBe('CANCELLED');
  });
});

describe('fallback titles follow the output language', () => {
  // Regression (v0.4.0 RC review): French summaries were titled "Untitled video".
  const body = JSON.stringify({
    choices: [{ message: { content: '{"tldr":"x","keyPoints":["a"]}' } }],
  });
  beforeEach(() => {
    resetSchemaFallback();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    );
  });

  it('untitled transcript and YouTube video, in French and German', async () => {
    const transcript = {
      videoId: 'v1',
      source: 'audio_transcription',
      language: 'fr',
      duration: 600,
      segments: [],
      fullText: 'bonjour',
      metadata: { title: null, provider: 'drive', extractedAt: '2026-10-18T00:00:00.000Z' },
    } as never;
    const fr = { ...DEFAULT_SETTINGS, openRouterKey: 'k', outputLanguage: 'fr' as const };
    const s = await summarize(transcript, fr);
    expect(s.title).toBe('Vidéo sans titre');
    expect(s.markdown.startsWith('# Vidéo sans titre')).toBe(true);
    const y = await summarizeYouTubeVideo(
      {
        id: 'y',
        provider: 'youtube',
        externalId: 'abc',
        title: null,
        duration: 60,
        iframeSrc: null,
        mediaSrc: null,
        isPlaying: false,
      },
      { ...fr, outputLanguage: 'de' },
    );
    expect(y.title).toBe('YouTube-Video');
    vi.unstubAllGlobals();
  });
});

describe('summary header per locale', () => {
  const header = (
    locale: 'en' | 'fr' | 'de' | 'es' | 'it',
    provider: string,
    src: TranscriptSource,
  ) =>
    renderSummary(
      {
        title: 'T',
        provider,
        durationLabel: 'D',
        transcriptSource: src,
        isoDate: '2026-07-24',
        locale: locale as never,
        content: sampleContent,
      },
      'detailed',
    );

  it('fr: French labels, U+202F before the colon, human provider', () => {
    const md = header('fr', 'native', 'audio_transcription');
    expect(md).toContain(
      '**Source :** Vidéo de la page · **Durée :** D · **Extrait le :** 2026-07-24',
    );
    expect(md).toContain('**Méthode :** Transcription audio');
    expect(md).toContain('## En bref');
    expect(md).not.toContain('native');
  });
  it('en: English labels and plain colon', () => {
    const md = header('en', 'drive', 'audio_transcription');
    expect(md).toContain(
      '**Source:** Google Drive · **Duration:** D · **Extracted on:** 2026-07-24',
    );
    expect(md).toContain('**Method:** Audio transcription');
    expect(md).toContain('## In brief');
  });
  it('de: German labels', () => {
    const md = header('de', 'vimeo', 'vimeo_captions');
    expect(md).toContain('**Quelle:** Vimeo · **Dauer:** D · **Extrahiert am:**');
    expect(md).toContain('**Methode:** Vimeo-Untertitel');
  });
  it('es: Spanish labels', () => {
    const md = header('es', 'native', 'youtube_captions');
    expect(md).toContain('**Fuente:** Vídeo de la página · **Duración:** D');
    expect(md).toContain('**Método:** Subtítulos de YouTube');
  });
  it('falls back to English for an unsupported language', () => {
    const md = header('it', 'youtube', 'youtube_captions');
    expect(md).toContain('**Source:** YouTube · **Duration:**');
    expect(md).toContain('## In brief');
  });
  it('keeps an unknown provider id as-is', () => {
    expect(header('en', 'weird', 'youtube_captions')).toContain('**Source:** weird');
  });
});
