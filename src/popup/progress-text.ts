import type { JobPercent } from '@/types';
import type { Messages } from '@/i18n/types';
import { formatNumber } from '@/i18n/format';
import { formatClock } from '@/shared/format';

/** Bytes → MB, locale-formatted with one decimal ("11,8" in French). */
const mb = (bytes: number, locale: string) => formatNumber(locale, bytes / (1024 * 1024), 1);

/** Localized phase line shown above the progress bar. */
export function phaseLabel(p: JobPercent, t: Messages): string {
  const known = p.total != null && p.total > 0 && p.done != null;
  const tp = t.progress;
  switch (p.phase) {
    case 'queued':
      return tp.queued(p.ahead ?? 1);
    case 'captions':
      return tp.captions;
    case 'download':
      if (known && p.unit === 'bytes')
        return tp.download(mb(p.done!, t.locale), mb(p.total!, t.locale));
      if (known && p.unit === 'items') return tp.downloadItems(p.done!, p.total!);
      return tp.downloading;
    case 'extract':
      return tp.extracting;
    case 'transcription':
      return known && p.unit === 'seconds'
        ? tp.transcription(formatClock(p.done!), formatClock(p.total!))
        : tp.transcribing;
    case 'summary':
    case 'done':
      return tp.summarizing;
  }
}

/** Estimated time left, localized; null when it is not shown (absent or < 5 s). */
export function etaLabel(p: JobPercent, t: Messages): string | null {
  if (p.etaSeconds == null || !Number.isFinite(p.etaSeconds) || p.etaSeconds < 5) return null;
  return t.progress.eta(Math.max(1, Math.round(p.etaSeconds / 60)));
}

/** Screen-reader text of the bar: phase, percent and ETA ("aria-valuetext"). */
export function progressValueText(p: JobPercent | undefined, t: Messages): string {
  if (!p) return t.progress.starting;
  const eta = etaLabel(p, t);
  return [phaseLabel(p, t), t.progress.percent(p.percent), eta].filter(Boolean).join(', ');
}
