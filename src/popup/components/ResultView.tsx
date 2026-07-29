import { useState } from 'preact/hooks';
import type { DetailLevel, Summary } from '@/types';
import { renderMarkdown } from '@/shared/markdown';
import { useI18n } from '@/i18n/context';
import { copyPlainText } from '../export';
import { downloadDocx } from '../export-docx';
import { downloadPdf } from '../export-pdf';

interface Props {
  summary: Summary;
  onBack: () => void;
  /** Present only for the active result: regenerate at a new length in place. */
  onChangeLength?: (level: DetailLevel) => void;
  regenerating?: boolean;
}

const LEVELS: DetailLevel[] = ['concise', 'standard', 'detailed'];

export function ResultView({ summary, onBack, onChangeLength, regenerating }: Props) {
  const t = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await copyPlainText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div class="screen">
      <header class="topbar">
        <button class="link" onClick={onBack}>
          {t.result.back}
        </button>
        <h1>{t.result.heading}</h1>
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

      <button class="primary" onClick={() => downloadPdf(summary)}>
        {t.result.downloadPdf}
      </button>
      <div class="actions">
        <button class="secondary" onClick={() => void downloadDocx(summary)}>
          {t.result.downloadWord}
        </button>
        <button class="secondary" onClick={() => void copy()}>
          {copied ? t.result.copied : t.result.copy}
        </button>
      </div>
    </div>
  );
}
