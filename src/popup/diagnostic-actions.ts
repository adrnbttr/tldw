import { useState } from 'preact/hooks';
import { isoDate } from '@/shared/format';
import { getDiagnosticReport } from './messaging';

/**
 * Shared actions for the diagnostic report (settings section + error row).
 *
 * The report is built by the worker from its local log buffer: nothing is ever
 * sent anywhere, and it never contains API keys.
 */

/** Copies the report to the clipboard with ~1.5 s "copied" feedback (like `saved`). */
export function useDiagnosticCopy(): { copied: boolean; copyDiagnostic: () => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const copyDiagnostic = async () => {
    await navigator.clipboard.writeText(await getDiagnosticReport());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return { copied, copyDiagnostic };
}

/** Saves the report as tldw-diagnostic-<YYYY-MM-DD>.txt (same pattern as downloadDocx). */
export async function downloadDiagnosticReport(): Promise<void> {
  const report = await getDiagnosticReport();
  const url = URL.createObjectURL(new Blob([report], { type: 'text/plain' }));
  await chrome.downloads.download({
    url,
    filename: `tldw-diagnostic-${isoDate()}.txt`,
    saveAs: false,
  });
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
