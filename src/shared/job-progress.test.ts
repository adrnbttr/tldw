import { describe, expect, it } from 'vitest';
import { createEtaEstimator, createProgressTracker, creep, phasePercent } from './job-progress';

const base = { phaseElapsed: 0, dataElapsed: 0 };

describe('creep', () => {
  it('starts at 0, grows, never reaches 1', () => {
    expect(creep(0, 10)).toBe(0);
    expect(creep(-5, 10)).toBe(0);
    expect(creep(10, 10)).toBeGreaterThan(creep(5, 10));
    expect(creep(10_000, 10)).toBeLessThan(1.0000001);
  });
});

describe('phasePercent', () => {
  it('weights the audio phases', () => {
    expect(phasePercent({ ...base, phase: 'queued' })).toBe(0);
    expect(phasePercent({ ...base, phase: 'download', data: { done: 50, total: 100 } })).toBe(15);
    expect(phasePercent({ ...base, phase: 'download', data: { done: 500, total: 100 } })).toBe(30);
    expect(phasePercent({ ...base, phase: 'extract' })).toBe(30);
    expect(phasePercent({ ...base, phase: 'transcription', data: { done: 0, total: 100 } })).toBe(
      30,
    );
    expect(phasePercent({ ...base, phase: 'transcription', data: { done: 50, total: 100 } })).toBe(
      57.5,
    );
    expect(phasePercent({ ...base, phase: 'done' })).toBe(100);
  });

  it('creeps (capped) when the download size is unknown', () => {
    const p = phasePercent({ phase: 'download', phaseElapsed: 1e6, dataElapsed: 1e6 });
    expect(p).toBeGreaterThan(27.9);
    expect(p).toBeLessThanOrEqual(28);
    expect(
      phasePercent({ phase: 'download', data: { done: 5 }, phaseElapsed: 0, dataElapsed: 0 }),
    ).toBe(0);
  });

  it('interpolates inside the current chunk without passing 90% of it', () => {
    const data = { done: 0, total: 100, until: 50 };
    const late = phasePercent({
      phase: 'transcription',
      data,
      phaseElapsed: 1e6,
      dataElapsed: 1e6,
    });
    expect(late).toBeGreaterThan(30);
    expect(late).toBeLessThanOrEqual(30 + 55 * 0.45 + 1e-9);
  });

  it('creeps without a known duration, staying under the phase end', () => {
    const p = phasePercent({ phase: 'transcription', phaseElapsed: 1e6, dataElapsed: 0 });
    expect(p).toBeLessThan(85);
    expect(p).toBeGreaterThan(80);
  });

  it('summary starts at the path base and stays under 97', () => {
    for (const [path, start] of [
      ['captions', 15],
      ['audio', 85],
      ['video', 0],
    ] as const) {
      expect(phasePercent({ ...base, phase: 'summary', summaryPath: path })).toBe(start);
      expect(
        phasePercent({ phase: 'summary', summaryPath: path, phaseElapsed: 1e6, dataElapsed: 0 }),
      ).toBeLessThanOrEqual(97);
    }
  });
});

describe('createProgressTracker', () => {
  it('is monotonic, bounded, and jumps to 100 on done', () => {
    let t = 0;
    const tr = createProgressTracker(() => t);
    tr.set('download', { done: 80, total: 100, unit: 'bytes' });
    const a = tr.snapshot().percent;
    // a later, lower measurement (restarted range) must not move the bar back
    tr.set('download', { done: 10, total: 100, unit: 'bytes' });
    expect(tr.snapshot().percent).toBe(a);
    tr.set('transcription', { done: 0, total: 100, unit: 'seconds' });
    expect(tr.snapshot().percent).toBeGreaterThanOrEqual(a);
    tr.beginSummary('audio');
    t += 1e7;
    const s = tr.snapshot();
    expect(s.phase).toBe('summary');
    expect(s.percent).toBeLessThanOrEqual(97);
    expect(s.percent).toBeGreaterThanOrEqual(85);
    expect(tr.done().percent).toBe(100);
  });

  it('exposes measured amounts and queue position', () => {
    const tr = createProgressTracker(() => 0);
    tr.set('queued', { ahead: 2 });
    expect(tr.snapshot()).toMatchObject({ phase: 'queued', percent: 0, ahead: 2 });
    tr.set('transcription', { done: 30, total: 60, unit: 'seconds' });
    expect(tr.snapshot()).toMatchObject({ done: 30, total: 60, unit: 'seconds' });
  });

  it('shows an ETA only from 10%, once the rate is stable', () => {
    let t = 0;
    const tr = createProgressTracker(() => t);
    tr.set('transcription', { done: 0, total: 1000, unit: 'seconds' });
    const etas: Array<number | undefined> = [];
    for (let i = 0; i < 20; i++) {
      t += 2500;
      tr.set('transcription', { done: i * 50, total: 1000, unit: 'seconds' });
      etas.push(tr.snapshot().etaSeconds);
    }
    expect(etas[0]).toBeUndefined();
    const last = etas[etas.length - 1];
    expect(last).toBeDefined();
    expect(last!).toBeGreaterThan(0);
    expect(last!).toBeLessThan(4 * 3600);
  });
});

describe('createEtaEstimator', () => {
  it('stays null with a single sample or erratic rates', () => {
    const e = createEtaEstimator();
    expect(e.sample(0, 10, 100)).toBeNull();
    expect(e.sample(3000, 11, 100)).toBeNull();
    // wildly different rate resets stability
    expect(e.sample(6000, 50, 100)).toBeNull();
  });

  it('estimates on a steady rate and rejects absurd values', () => {
    const e = createEtaEstimator();
    let eta: number | null = null;
    for (let i = 0; i <= 6; i++) eta = e.sample(i * 3000, 10 + i * 3, 100);
    // 1%/s → 100 - 28 = 72 s left
    expect(eta).toBeGreaterThan(60);
    expect(eta).toBeLessThan(85);
    const slow = createEtaEstimator({ maxEtaSeconds: 10 });
    let s: number | null = null;
    for (let i = 0; i <= 6; i++) s = slow.sample(i * 3000, 10 + i * 3, 100);
    expect(s).toBeNull();
  });
});
