import { describe, it, expect } from 'vitest';
import type { Summary } from '@/types';
import { concatMarkdown, exportFilename } from './export';

function makeSummary(title: string, markdown: string): Summary {
  return {
    videoId: 'v',
    title,
    provider: 'youtube',
    durationLabel: '5 min',
    transcriptSource: 'youtube_captions',
    createdAt: '2026-07-24T10:30:00Z',
    model: 'anthropic/claude-sonnet-4',
    content: { tldr: '', keyPoints: [], sections: [], glossary: [], takeaways: [] },
    markdown,
  };
}

describe('concatMarkdown', () => {
  it('joins summaries with a horizontal rule separator', () => {
    const out = concatMarkdown([
      makeSummary('A', '# A\ncontent a'),
      makeSummary('B', '# B\ncontent b'),
    ]);
    expect(out).toContain('# A');
    expect(out).toContain('# B');
    expect(out).toContain('\n\n---\n\n');
  });
});

describe('exportFilename', () => {
  it('builds a dated, slugified filename', () => {
    expect(exportFilename(makeSummary('Résumé Vidéo', '# x'))).toBe('2026-07-24-resume-video.md');
  });
});
