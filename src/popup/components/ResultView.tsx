import { useMemo, useState } from 'preact/hooks';
import type { DetailLevel, DownloadFormat, Summary } from '@/types';
import { renderMarkdown } from '@/shared/markdown';
import { renderSummary } from '@/summarizer/template';
import { useI18n } from '@/i18n/context';
import { copyPlainText } from '../export';
import { downloadDocx } from '../export-docx';
import { downloadPdf } from '../export-pdf';
import { Breadcrumb } from './Breadcrumb';

interface Props {
  summary: Summary;
  onBack: () => void;
  /** Breadcrumb root label — where "back" goes (Videos, or History). */
  backLabel: string;
  /** Export format featured as the primary button. */
  primaryFormat: DownloadFormat;
}

const LEVELS: DetailLevel[] = ['concise', 'standard', 'detailed'];

export function ResultView({ summary, onBack, backLabel, primaryFormat }: Props) {
  const t = useI18n();
  const [copied, setCopied] = useState(false);

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

  const copy = async () => {
    await copyPlainText(view);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const savePdf = () => downloadPdf(view);
  const saveWord = () => void downloadDocx(view);
  const pdfFirst = primaryFormat === 'pdf';

  return (
    <div class="screen">
      <header class="topbar">
        <Breadcrumb rootLabel={backLabel} current={t.result.heading} onRoot={onBack} />
      </header>

      <p class="method">{t.result.method(t.sources[summary.transcriptSource])}</p>

      <div class="length-switch">
        <span class="length-label">{t.result.length}</span>
        <div class="segmented">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              class={level === lvl ? 'seg active' : 'seg'}
              onClick={() => setLevel(lvl)}
            >
              {t.settings.detailLevels[lvl]}
            </button>
          ))}
        </div>
      </div>

      <div
        class="markdown"
        // Rendered from our own template output, not arbitrary user Markdown.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(view.markdown) }}
      />

      <button class="primary" onClick={pdfFirst ? savePdf : saveWord}>
        {pdfFirst ? t.result.downloadPdf : t.result.downloadWord}
      </button>
      <div class="actions">
        <button class="secondary" onClick={pdfFirst ? saveWord : savePdf}>
          {pdfFirst ? 'Word' : 'PDF'}
        </button>
        <button class="secondary" onClick={() => void copy()}>
          {copied ? t.result.copied : t.result.copy}
        </button>
      </div>
    </div>
  );
}
