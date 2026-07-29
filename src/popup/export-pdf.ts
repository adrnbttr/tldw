import { jsPDF } from 'jspdf';
import type { Summary } from '@/types';
import { templateStrings, detectSummaryLocale, lengthParts } from '@/summarizer/template';
import { isoDate, slugify } from '@/shared/format';

/**
 * PDF export (F8).
 *
 * A clean, selectable-text PDF built from the structured summary with manual
 * layout (headings, wrapped paragraphs, bullets, page breaks), localized in the
 * summary's output language.
 */

const MARGIN = 56;
const ACCENT: [number, number, number] = [79, 70, 229];
const MUTED: [number, number, number] = [107, 114, 128];
const FG: [number, number, number] = [26, 26, 26];

// jsPDF standard fonts are WinAnsi; keep punctuation within that range.
function ascii(text: string): string {
  return text.replace(/—/g, '-').replace(/…/g, '...').replace(/·/g, '-');
}

function renderSummary(doc: jsPDF, summary: Summary): void {
  const s = templateStrings(detectSummaryLocale(summary.markdown));
  const c = summary.content;
  const parts = lengthParts(summary.detailLevel);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - MARGIN * 2;
  let y = MARGIN;

  const ensure = (needed: number) => {
    if (y + needed > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const text = (
    value: string,
    opts: {
      size: number;
      bold?: boolean;
      color?: [number, number, number];
      gap?: number;
      indent?: number;
    },
  ) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size);
    doc.setTextColor(...(opts.color ?? FG));
    const indent = opts.indent ?? 0;
    const lines = doc.splitTextToSize(ascii(value), width - indent) as string[];
    const lineHeight = opts.size * 1.35;
    for (const line of lines) {
      ensure(lineHeight);
      doc.text(line, MARGIN + indent, y);
      y += lineHeight;
    }
    y += opts.gap ?? 0;
  };

  const bullets = (items: string[]) => {
    for (const item of items.filter((i) => i.trim())) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(...FG);
      const lines = doc.splitTextToSize(ascii(item.trim()), width - 16) as string[];
      const lineHeight = 11 * 1.35;
      lines.forEach((line, i) => {
        ensure(lineHeight);
        if (i === 0) doc.text('•', MARGIN, y);
        doc.text(line, MARGIN + 16, y);
        y += lineHeight;
      });
    }
    y += 6;
  };

  const heading = (label: string) => {
    ensure(28);
    y += 8;
    text(label, { size: 14, bold: true, color: ACCENT, gap: 4 });
  };

  text(summary.title, { size: 22, bold: true, color: ACCENT, gap: 6 });
  text(
    `${s.source}: ${summary.provider}  -  ${s.duration}: ${summary.durationLabel}  -  ${s.extractedOn}: ${isoDate(new Date(summary.createdAt))}`,
    { size: 9, color: MUTED },
  );
  text(`${s.method}: ${s.sources[summary.transcriptSource]}`, { size: 9, color: MUTED, gap: 6 });

  heading(s.inBrief);
  text(c.tldr.trim(), { size: 11, gap: 4 });

  heading(s.keyPoints);
  bullets(c.keyPoints);

  if (parts.sections && c.sections.length > 0) {
    heading(s.development);
    for (const section of c.sections) {
      text(section.heading.trim(), { size: 12, bold: true, gap: 2 });
      text(section.body.trim(), { size: 11, gap: 4 });
    }
  }

  if (parts.glossary && c.glossary.length > 0) {
    heading(s.glossary);
    bullets(c.glossary.map((g) => `${g.term.trim()} - ${g.definition.trim()}`));
  }

  heading(s.toRemember);
  bullets(c.takeaways);
}

export function buildPdf(summary: Summary): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  renderSummary(doc, summary);
  return doc;
}

export function downloadPdf(summary: Summary): void {
  const filename = `${isoDate(new Date(summary.createdAt))}-${slugify(summary.title)}.pdf`;
  buildPdf(summary).save(filename);
}

/** One combined PDF for a batch: each summary on its own page(s). */
export function downloadPdfBatch(summaries: Summary[]): void {
  if (summaries.length === 0) return;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  summaries.forEach((summary, i) => {
    if (i > 0) doc.addPage();
    renderSummary(doc, summary);
  });
  doc.save(`${isoDate()}-summaries-tldw.pdf`);
}
