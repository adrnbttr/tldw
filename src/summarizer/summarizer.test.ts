import { describe, it, expect } from 'vitest';
import { parseSummaryContent, splitIntoBlocks } from './index';
import { getTemplate, listTemplates, detectSummaryLocale } from './template';

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

describe('template rendering', () => {
  it('produces a stable Markdown structure', () => {
    const md = getTemplate('default-v1').render({
      title: 'Titre',
      provider: 'youtube',
      durationLabel: '30 min 47',
      transcriptSource: 'youtube_captions',
      isoDate: '2026-07-24',
      locale: 'fr',
      content: {
        tldr: 'En bref.',
        keyPoints: ['Point 1', 'Point 2'],
        sections: [{ heading: 'Intro', body: 'Corps.' }],
        glossary: [{ term: 'Terme', definition: 'Déf.' }],
        takeaways: ['À retenir.'],
      },
    });
    expect(md).toContain('# Titre');
    expect(md).toContain('## En bref');
    expect(md).toContain('## Points clés');
    expect(md).toContain('**Méthode:** Sous-titres YouTube');
    expect(md).toContain('- **Terme** — Déf.');
  });

  it('detects the summary language from its headings', () => {
    expect(detectSummaryLocale('# T\n\n## En bref\nx')).toBe('fr');
    expect(detectSummaryLocale('# T\n\n## In brief\nx')).toBe('en');
    expect(detectSummaryLocale('# T\n\n## Kurz gesagt\nx')).toBe('de');
    expect(detectSummaryLocale('# T\n\n## En resumen\nx')).toBe('es');
    expect(detectSummaryLocale('no headings here')).toBe('en');
  });

  it('localizes headings by output language', () => {
    const render = (locale: 'en' | 'de') =>
      getTemplate('default-v1').render({
        title: 'T',
        provider: 'youtube',
        durationLabel: '5 min',
        transcriptSource: 'youtube_captions',
        isoDate: '2026-07-24',
        locale,
        content: { tldr: 'x', keyPoints: ['p'], sections: [], glossary: [], takeaways: ['r'] },
      });
    expect(render('en')).toContain('## In brief');
    expect(render('de')).toContain('## Kurz gesagt');
  });

  it('exposes at least the default and compact templates', () => {
    const ids = listTemplates().map((t) => t.id);
    expect(ids).toContain('default-v1');
    expect(ids).toContain('compact-v1');
  });

  it('compact template omits Développement and glossary', () => {
    const md = getTemplate('compact-v1').render({
      title: 'Titre',
      provider: 'youtube',
      durationLabel: '5 min',
      transcriptSource: 'youtube_captions',
      isoDate: '2026-07-24',
      locale: 'fr',
      content: {
        tldr: 'Bref.',
        keyPoints: ['P1'],
        sections: [{ heading: 'Intro', body: 'X' }],
        glossary: [{ term: 'T', definition: 'D' }],
        takeaways: ['R1'],
      },
    });
    expect(md).toContain('## En bref');
    expect(md).toContain('## À retenir');
    expect(md).not.toContain('## Développement');
    expect(md).not.toContain('## Notions');
  });
});
