import { useState } from 'preact/hooks';
import { isoDate } from '@/shared/format';
import { clearLogs, getDiagnosticReport } from './messaging';

/**
 * Shared actions for the diagnostic report (settings section + error row).
 *
 * The report is built by the worker from its local log buffer: nothing is ever
 * sent anywhere, and it never contains API keys. Every action reports its
 * outcome truthfully: `ok` only after the work really succeeded, `failed`
 * on any rejection (worker refusal, clipboard, downloads…).
 */

export type ActionStatus = 'idle' | 'ok' | 'failed';

/** Runs `action`, flips status to ok/failed for ~1.5 s ("copied" feedback, like `saved`). */
function useTimedAction(action: () => Promise<void>): {
  status: ActionStatus;
  run: () => Promise<void>;
} {
  const [status, setStatus] = useState<ActionStatus>('idle');
  const run = async () => {
    try {
      await action();
      setStatus('ok');
    } catch {
      setStatus('failed');
    }
    setTimeout(() => setStatus('idle'), 1500);
  };
  return { status, run };
}

/** Writes the worker's report to the clipboard; rejects if either step fails. */
export async function copyDiagnosticReport(): Promise<void> {
  await navigator.clipboard.writeText(await getDiagnosticReport());
}

/** Saves the report as tldw-diagnostic-<YYYY-MM-DD>.txt (same pattern as downloadDocx). */
export async function downloadDiagnosticReport(): Promise<void> {
  const report = await getDiagnosticReport();
  const url = URL.createObjectURL(new Blob([report], { type: 'text/plain' }));
  try {
    await chrome.downloads.download({
      url,
      filename: `tldw-diagnostic-${isoDate()}.txt`,
      saveAs: false,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export function useDiagnosticCopy(): {
  copied: boolean;
  failed: boolean;
  copyDiagnostic: () => Promise<void>;
} {
  const { status, run } = useTimedAction(copyDiagnosticReport);
  return { copied: status === 'ok', failed: status === 'failed', copyDiagnostic: run };
}

export function useDiagnosticDownload(): {
  failed: boolean;
  download: () => Promise<void>;
} {
  const { status, run } = useTimedAction(downloadDiagnosticReport);
  return { failed: status === 'failed', download: run };
}

export function useClearLogs(): {
  cleared: boolean;
  failed: boolean;
  clear: () => Promise<void>;
} {
  const { status, run } = useTimedAction(clearLogs);
  return { cleared: status === 'ok', failed: status === 'failed', clear: run };
}
