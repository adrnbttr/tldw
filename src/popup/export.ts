import type { Summary } from '@/types';
import { isoDate, slugify } from '@/shared/format';

/** Export helpers (F8). */

export function exportFilename(summary: Summary): string {
  return `${isoDate(new Date(summary.createdAt))}-${slugify(summary.title)}.md`;
}

export function downloadMarkdown(summary: Summary): void {
  const blob = new Blob([summary.markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: exportFilename(summary), saveAs: false }, () =>
    setTimeout(() => URL.revokeObjectURL(url), 10_000),
  );
}

export async function copyMarkdown(summary: Summary): Promise<void> {
  await navigator.clipboard.writeText(summary.markdown);
}

/** Strips Markdown syntax so a paste is clean prose, not `#`/`**`/`-`. */
export function toPlainText(markdown: string): string {
  return (
    markdown
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*/g, '')
      .replace(/^\s*[-*]\s+/gm, '• ')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

export async function copyPlainText(summary: Summary): Promise<void> {
  await navigator.clipboard.writeText(toPlainText(summary.markdown));
}

/** Concatenates several summaries into one Markdown document (F8 batch export). */
export function concatMarkdown(summaries: Summary[]): string {
  return summaries.map((s) => s.markdown.trim()).join('\n\n---\n\n') + '\n';
}

export function downloadBatchMarkdown(summaries: Summary[]): void {
  const blob = new Blob([concatMarkdown(summaries)], {
    type: 'text/markdown;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: `${isoDate()}-resumes-tldw.md`, saveAs: false }, () =>
    setTimeout(() => URL.revokeObjectURL(url), 10_000),
  );
}
