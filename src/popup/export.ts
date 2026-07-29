import type { Summary } from '@/types';
import { isoDate, slugify } from '@/shared/format';

/** Export helpers (F8). PDF/Word live in export-pdf.ts / export-docx.ts. */

export function exportFilename(summary: Summary): string {
  return `${isoDate(new Date(summary.createdAt))}-${slugify(summary.title)}.md`;
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

/** Concatenates several summaries into one document (used by tests/reuse). */
export function concatMarkdown(summaries: Summary[]): string {
  return summaries.map((s) => s.markdown.trim()).join('\n\n---\n\n') + '\n';
}
