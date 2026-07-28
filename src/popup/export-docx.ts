import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import type { Summary } from '@/types';
import { templateStrings } from '@/summarizer/template';
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
  const s = templateStrings(summary.locale);
  const c = summary.content;
  const children: Paragraph[] = [];

  children.push(new Paragraph({ text: summary.title, heading: HeadingLevel.TITLE }));
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${s.source}: ${summary.provider}  ·  ${s.duration}: ${summary.durationLabel}  ·  ${s.extractedOn}: ${isoDate(new Date(summary.createdAt))}`,
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
          text: `${s.method}: ${s.sources[summary.transcriptSource]}`,
          color: MUTED,
          size: 18,
        }),
      ],
    }),
  );

  children.push(new Paragraph({ text: s.inBrief, heading: HeadingLevel.HEADING_1 }));
  children.push(new Paragraph({ text: c.tldr.trim() }));

  children.push(new Paragraph({ text: s.keyPoints, heading: HeadingLevel.HEADING_1 }));
  children.push(...bullets(c.keyPoints));

  if (c.sections.length > 0) {
    children.push(new Paragraph({ text: s.development, heading: HeadingLevel.HEADING_1 }));
    for (const section of c.sections) {
      children.push(
        new Paragraph({ text: section.heading.trim(), heading: HeadingLevel.HEADING_2 }),
      );
      children.push(new Paragraph({ text: section.body.trim() }));
    }
  }

  if (c.glossary.length > 0) {
    children.push(new Paragraph({ text: s.glossary, heading: HeadingLevel.HEADING_1 }));
    for (const { term, definition } of c.glossary) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: `${term.trim()} — `, bold: true }),
            new TextRun({ text: definition.trim() }),
          ],
        }),
      );
    }
  }

  children.push(new Paragraph({ text: s.toRemember, heading: HeadingLevel.HEADING_1 }));
  children.push(...bullets(c.takeaways));

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
