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
