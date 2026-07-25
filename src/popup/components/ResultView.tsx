import { useState } from 'preact/hooks';
import type { Summary } from '@/types';
import { renderMarkdown } from '@/shared/markdown';
import { useI18n } from '@/i18n/context';
import { copyMarkdown, downloadMarkdown } from '../export';

interface Props {
  summary: Summary;
  onBack: () => void;
}

export function ResultView({ summary, onBack }: Props) {
  const t = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await copyMarkdown(summary);
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

      <div
        class="markdown"
        // Rendered from our own template output, not arbitrary user Markdown.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(summary.markdown) }}
      />

      <div class="actions">
        <button class="primary" onClick={() => downloadMarkdown(summary)}>
          {t.result.download}
        </button>
        <button class="secondary" onClick={() => void copy()}>
          {copied ? t.result.copied : t.result.copy}
        </button>
      </div>
    </div>
  );
}
