import { describe, expect, it } from 'vitest';
import { getCatalog } from '@/i18n';
import { etaLabel, phaseLabel, progressValueText } from './progress-text';

const fr = getCatalog('fr');
const en = getCatalog('en');
const de = getCatalog('de');
const es = getCatalog('es');
const NNBSP = '\u202F';
const NBSP = '\u00A0';
const bytes = 1024 * 1024;

describe('phaseLabel', () => {
  it('formats transcription as clocks of video processed', () => {
    expect(
      phaseLabel(
        { percent: 50, phase: 'transcription', done: 1450, total: 3510, unit: 'seconds' },
        fr,
      ),
    ).toBe('Transcription · 24:10 / 58:30 de vidéo');
  });

  it('formats download sizes with the locale decimal separator', () => {
    const p = {
      percent: 1,
      phase: 'download' as const,
      done: 12_345_678,
      total: 987_654_321,
      unit: 'bytes' as const,
    };
    expect(phaseLabel(p, fr)).toBe(`Téléchargement · 11,8 / 941,9${NNBSP}Mo`);
    expect(phaseLabel(p, de)).toBe(`Herunterladen · 11,8 / 941,9${NBSP}MB`);
    expect(phaseLabel(p, es)).toBe(`Descarga · 11,8 / 941,9${NBSP}MB`);
    expect(phaseLabel(p, en)).toBe(`Downloading · 11.8 / 941.9${NBSP}MB`);
    expect(
      phaseLabel(
        { percent: 9, phase: 'download', done: 120 * bytes, total: 410 * bytes, unit: 'bytes' },
        fr,
      ),
    ).toBe(`Téléchargement · 120 / 410${NNBSP}Mo`);
  });

  it('pluralizes the queue and never says "job"', () => {
    expect(phaseLabel({ percent: 0, phase: 'queued', ahead: 1 }, fr)).toBe(
      'En attente (1 vidéo avant)…',
    );
    expect(phaseLabel({ percent: 0, phase: 'queued', ahead: 3 }, fr)).toBe(
      'En attente (3 vidéos avant)…',
    );
    expect(phaseLabel({ percent: 0, phase: 'queued', ahead: 1 }, en)).toBe(
      'Waiting (1 video ahead)…',
    );
    expect(phaseLabel({ percent: 0, phase: 'queued', ahead: 2 }, en)).toBe(
      'Waiting (2 videos ahead)…',
    );
    expect(phaseLabel({ percent: 90, phase: 'summary' }, fr)).toBe('Rédaction du résumé…');
    expect(phaseLabel({ percent: 5, phase: 'download' }, fr)).toBe('Téléchargement…');
  });
});

describe('etaLabel', () => {
  it('hides missing or tiny estimates and rounds to minutes', () => {
    expect(etaLabel({ percent: 40, phase: 'transcription' }, fr)).toBeNull();
    expect(etaLabel({ percent: 40, phase: 'transcription', etaSeconds: 2 }, fr)).toBeNull();
    expect(etaLabel({ percent: 40, phase: 'transcription', etaSeconds: 170 }, fr)).toBe(
      `≈${NBSP}3${NNBSP}min restantes`,
    );
  });

  it('agrees in number (singular for one minute)', () => {
    expect(etaLabel({ percent: 40, phase: 'transcription', etaSeconds: 50 }, fr)).toBe(
      `≈${NBSP}1${NNBSP}min restante`,
    );
    expect(etaLabel({ percent: 40, phase: 'transcription', etaSeconds: 50 }, es)).toBe(
      `Queda ≈${NBSP}1${NBSP}min`,
    );
    expect(etaLabel({ percent: 40, phase: 'transcription', etaSeconds: 300 }, es)).toBe(
      `Quedan ≈${NBSP}5${NBSP}min`,
    );
  });

  it('switches to hours past 59 minutes', () => {
    expect(etaLabel({ percent: 10, phase: 'transcription', etaSeconds: 3900 }, fr)).toBe(
      `≈${NBSP}1${NNBSP}h${NNBSP}05 restantes`,
    );
    expect(etaLabel({ percent: 10, phase: 'transcription', etaSeconds: 3900 }, de)).toBe(
      `noch ca. 1${NBSP}Std. 05${NBSP}Min.`,
    );
  });
});

describe('progressValueText', () => {
  it('reads phase, percent and ETA', () => {
    expect(
      progressValueText(
        {
          percent: 47,
          phase: 'transcription',
          done: 754,
          total: 3725,
          unit: 'seconds',
          etaSeconds: 400,
        },
        fr,
      ),
    ).toBe(`Transcription · 12:34 / 1:02:05 de vidéo, 47${NNBSP}%, ≈${NBSP}7${NNBSP}min restantes`);
  });

  it('omits a missing ETA and covers the not-yet-measured state', () => {
    expect(progressValueText({ percent: 3, phase: 'captions' }, en)).toBe('Fetching captions…, 3%');
    expect(progressValueText(undefined, fr)).toBe('Préparation…');
  });
});
