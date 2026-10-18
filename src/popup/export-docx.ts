import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import type { Summary } from '@/types';
import {
  templateStrings,
  detectSummaryLocale,
  lengthParts,
  normalizeContent,
  providerLabel,
  labelled,
} from '@/summarizer/template';
import { isoDate, slugify } from '@/shared/format';

/**
 * Word (.docx) export (F8).
 *
 * Builds a properly formatted document from the structured summary — headings,
 * bullet lists, bold glossary terms — localized in the summary's output language.
 * Nicer than raw Markdown for non-technical readers.
 */

const ACCENT = '4F46E5';
const MUTED = '6B7280';

function bullets(items: string[]): Paragraph[] {
  return items
    .filter((i) => i.trim())
    .map((i) => new Paragraph({ text: i.trim(), bullet: { level: 0 } }));
}

export function buildDocx(summary: Summary): Document {
  const locale = detectSummaryLocale(summary.markdown);
  const s = templateStrings(locale);
  // Empty parts (degenerate model output) are skipped, headings included.
  const c = normalizeContent(summary.content);
  const parts = lengthParts(summary.detailLevel);
  const children: Paragraph[] = [];

  children.push(new Paragraph({ text: summary.title, heading: HeadingLevel.TITLE }));
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${labelled(s, s.source)} ${providerLabel(summary.provider, locale)}  ·  ${labelled(s, s.duration)} ${summary.durationLabel}  ·  ${labelled(s, s.extractedOn)} ${isoDate(new Date(summary.createdAt))}`,
          color: MUTED,
          size: 18,
        }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `${labelled(s, s.method)} ${s.sources[summary.transcriptSource]}`,
          color: MUTED,
          size: 18,
        }),
      ],
    }),
  );

  if (c.tldr) {
    children.push(new Paragraph({ text: s.inBrief, heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ text: c.tldr }));
  }

  if (c.keyPoints.length) {
    children.push(new Paragraph({ text: s.keyPoints, heading: HeadingLevel.HEADING_1 }));
    children.push(...bullets(c.keyPoints.slice(0, parts.keyPoints)));
  }

  if (parts.sections && c.sections.length > 0) {
    children.push(new Paragraph({ text: s.development, heading: HeadingLevel.HEADING_1 }));
    for (const section of c.sections) {
      if (section.heading) {
        children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_2 }));
      }
      if (section.body) children.push(new Paragraph({ text: section.body }));
    }
  }

  if (parts.glossary && c.glossary.length > 0) {
    children.push(new Paragraph({ text: s.glossary, heading: HeadingLevel.HEADING_1 }));
    for (const { term, definition } of c.glossary) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: definition ? `${term} — ` : term, bold: true }),
            new TextRun({ text: definition }),
          ],
        }),
      );
    }
  }

  if (c.takeaways.length) {
    children.push(new Paragraph({ text: s.toRemember, heading: HeadingLevel.HEADING_1 }));
    children.push(...bullets(c.takeaways.slice(0, parts.takeaways)));
  }

  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          run: { size: 44, bold: true, color: ACCENT },
          paragraph: { alignment: AlignmentType.LEFT, spacing: { after: 120 } },
        },
      ],
    },
    sections: [{ children }],
  });
}

export async function downloadDocx(summary: Summary): Promise<void> {
  const blob = await Packer.toBlob(buildDocx(summary));
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: `${isoDate(new Date(summary.createdAt))}-${slugify(summary.title)}.docx`,
    saveAs: false,
  });
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
