import { useState } from 'preact/hooks';
import type { Summary } from '@/types';
import { renderMarkdown } from '@/shared/markdown';
import { sourceLabel } from '@/summarizer/template';
import { copyMarkdown, downloadMarkdown } from '../export';

interface Props {
  summary: Summary;
  onBack: () => void;
}

export function ResultView({ summary, onBack }: Props) {
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
          ← Retour
        </button>
        <h1>Résumé</h1>
      </header>

      <p class="method">Méthode : {sourceLabel(summary.transcriptSource)}</p>

      <div
        class="markdown"
        // Rendered from our own template output, not arbitrary user Markdown.
        dangerouslySetInnerHTML={{ __html: renderMarkdown(summary.markdown) }}
      />

      <div class="actions">
        <button class="primary" onClick={() => downloadMarkdown(summary)}>
          Télécharger (.md)
        </button>
        <button class="secondary" onClick={() => void copy()}>
          {copied ? 'Copié ✓' : 'Copier'}
        </button>
      </div>
    </div>
  );
}
