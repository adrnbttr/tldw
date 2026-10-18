import { useMemo, useState } from 'preact/hooks';
import type { DetailLevel, DownloadFormat, Summary } from '@/types';
import { renderMarkdown } from '@/shared/markdown';
import { renderSummary } from '@/summarizer/template';
import { useI18n } from '@/i18n/context';
import { copyPlainText } from '../export';
import { Breadcrumb } from './Breadcrumb';

interface Props {
  summary: Summary;
  onBack: () => void;
  /** Breadcrumb root label — where "back" goes (Videos, or History). */
  backLabel: string;
  /** Export format featured as the primary button. */
  primaryFormat: DownloadFormat;
  /** Regenerate (bypassing the saved summary) — only for a live video of the page. */
  onRegenerate?: () => void;
}

const LEVELS: DetailLevel[] = ['concise', 'standard', 'detailed'];

type Action = 'copy' | 'pdf' | 'docx';

export function ResultView({ summary, onBack, backLabel, primaryFormat, onRegenerate }: Props) {
  const t = useI18n();
  // Per-action feedback, shown on the button itself for ~1.5 s.
  const [feedback, setFeedback] = useState<{ action: Action; ok: boolean } | null>(null);

  // Length is a render-time choice over the one rich generation — switching is
  // instant and free (no model call), and works from history too.
  const initial: DetailLevel = LEVELS.includes(summary.detailLevel)
    ? summary.detailLevel
    : 'standard';
  const [level, setLevel] = useState<DetailLevel>(initial);

  // The summary as currently viewed: markdown re-rendered at the chosen length,
  // so downloads and copy match exactly what's on screen.
  const view: Summary = useMemo(
    () => ({
      ...summary,
      detailLevel: level,
      markdown: renderSummary(
        {
          title: summary.title,
          provider: summary.provider,
          durationLabel: summary.durationLabel,
          transcriptSource: summary.transcriptSource,
          isoDate: summary.createdAt.slice(0, 10),
          locale: summary.locale,
          content: summary.content,
        },
        level,
      ),
    }),
    [summary, level],
  );

  /** Runs an action; a failure (clipboard, chunk load, download) shows on its button. */
  const run = async (action: Action, work: () => Promise<void>, showSuccess: boolean) => {
    try {
      await work();
      if (!showSuccess) return;
      setFeedback({ action, ok: true });
    } catch {
      setFeedback({ action, ok: false });
    }
    setTimeout(() => setFeedback(null), 1500);
  };

  // Export libraries (jsPDF / docx) are heavy — load them on demand so they never
  // weigh down the popup's initial bundle.
  const exportAs = (format: DownloadFormat) =>
    run(
      format,
      async () => {
        if (format === 'pdf') (await import('../export-pdf')).downloadPdf(view);
        else await (await import('../export-docx')).downloadDocx(view);
      },
      false,
    );
  const copy = () => run('copy', () => copyPlainText(view), true);

  const label = (action: Action, idle: string) =>
    feedback?.action === action ? (feedback.ok ? t.result.copied : t.result.failed) : idle;
  const primary: DownloadFormat = primaryFormat === 'docx' ? 'docx' : 'pdf';
  const other: DownloadFormat = primary === 'pdf' ? 'docx' : 'pdf';
  const exportLabel = (f: DownloadFormat) =>
    f === 'pdf' ? t.result.downloadPdf : t.result.downloadWord;

  return (
    <div class="screen">
      <header class="topbar">
        <Breadcrumb rootLabel={backLabel} current={t.result.heading} onRoot={onBack} />
      </header>

      <p class="method">{t.result.method(t.sources[summary.transcriptSource])}</p>
      {summary.partial && (
        <p class="partial-notice" role="note">
          {t.result.partialNotice}
        </p>
      )}

      <div class="length-switch">
        <span class="length-label">{t.result.length}</span>
        <div class="segmented" role="group" aria-label={t.result.length}>
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              class={level === lvl ? 'seg active' : 'seg'}
              aria-pressed={level === lvl}
              onClick={() => setLevel(lvl)}
            >
              {t.settings.detailLevels[lvl]}
            </button>
          ))}
        </div>
      </div>

      <div
        class="markdown"
        // Scrollable region: focusable so the keyboard can scroll it.
        tabIndex={0}
        role="region"
        aria-label={t.result.heading}
        // Rendered from our own template output, not arbitrary user Markdown.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(view.markdown) }}
      />

      <div class="result-actions" aria-live="polite">
        <button class="primary" onClick={() => void exportAs(primary)}>
          {label(primary, exportLabel(primary))}
        </button>
        <div class="result-secondary">
          <button class="secondary" onClick={() => void exportAs(other)}>
            {label(other, exportLabel(other))}
          </button>
          <button class="secondary" onClick={() => void copy()}>
            {label('copy', t.result.copy)}
          </button>
          {onRegenerate && (
            <button class="secondary" onClick={onRegenerate}>
              {t.result.regenerate}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
