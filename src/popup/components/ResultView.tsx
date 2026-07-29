import { useState } from 'preact/hooks';
import type { DetailLevel, DownloadFormat, Summary } from '@/types';
import { renderMarkdown } from '@/shared/markdown';
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
  /** Present only for the active result: regenerate at a new length in place. */
  onChangeLength?: (level: DetailLevel) => void;
  regenerating?: boolean;
}

const LEVELS: DetailLevel[] = ['concise', 'standard', 'detailed'];

export function ResultView({
  summary,
  onBack,
  backLabel,
  primaryFormat,
  onChangeLength,
  regenerating,
}: Props) {
  const t = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await copyPlainText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const savePdf = () => downloadPdf(summary);
  const saveWord = () => void downloadDocx(summary);
  const pdfFirst = primaryFormat === 'pdf';

  return (
    <div class="screen">
      <header class="topbar">
        <Breadcrumb rootLabel={backLabel} current={t.result.heading} onRoot={onBack} />
      </header>

      <p class="method">{t.result.method(t.sources[summary.transcriptSource])}</p>

      {onChangeLength && (
        <div class={`length-switch ${regenerating ? 'busy' : ''}`}>
          <span class="length-label">{t.result.length}</span>
          <div class="segmented">
            {LEVELS.map((level) => (
              <button
                key={level}
                class={summary.detailLevel === level ? 'seg active' : 'seg'}
                disabled={regenerating}
                onClick={() => level !== summary.detailLevel && onChangeLength(level)}
              >
                {t.settings.detailLevels[level]}
              </button>
            ))}
          </div>
          {regenerating && (
            <span class="spinner" aria-label="…">
              ⟳
            </span>
          )}
        </div>
      )}

      <div
        class="markdown"
        // Rendered from our own template output, not arbitrary user Markdown.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(summary.markdown) }}
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
