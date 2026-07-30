import { describe, it, expect } from 'vitest';
import type { DetailLevel } from '@/types';
import { parseSummaryContent, splitIntoBlocks, lengthDirective } from './index';
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
    expect(md).toContain('**Méthode:** Sous-titres YouTube');
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
