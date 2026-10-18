import type { JobPercent, ProgressData } from '@/types';

/**
 * Job progress (spec addendum): a monotonic 0-100 percentage computed in the
 * worker from the phase events the pipeline already emits.
 *
 * Weighted phases:
 * - captions path   : captions 0→15, summary 15→100
 * - audio path      : queued 0, download 0→30, extract 30, transcription 30→85,
 *                     summary 85→100
 * - video-URL path  : summary only 0→100
 *
 * Phases with no real measure (summary LLM call, download of unknown size…)
 * "creep": they approach a cap asymptotically so the bar keeps moving without
 * ever lying about being finished; `done` jumps to 100.
 */

export type SummaryPath = 'captions' | 'audio' | 'video';

const CAPTIONS_END = 15;
const DOWNLOAD_END = 30;
const DOWNLOAD_CREEP_CAP = 28;
const TRANSCRIBE_END = 85;
const SUMMARY_CAP = 97;
const MAX_BEFORE_DONE = 99;

const SUMMARY_BASE: Record<SummaryPath, number> = { captions: CAPTIONS_END, audio: 85, video: 0 };
const SUMMARY_TAU_S: Record<SummaryPath, number> = { captions: 25, audio: 25, video: 40 };

/** 1 - e^(-elapsed/tau): 0 at the start, → 1 asymptotically. */
export function creep(elapsedSeconds: number, tauSeconds: number): number {
  if (!(elapsedSeconds > 0) || !(tauSeconds > 0)) return 0;
  return 1 - Math.exp(-elapsedSeconds / tauSeconds);
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const hasTotal = (d?: ProgressData): d is ProgressData & { done: number; total: number } =>
  !!d && typeof d.total === 'number' && d.total > 0 && typeof d.done === 'number';

type Phase = JobPercent['phase'];

/**
 * Raw (non-monotonic) percentage of one phase at a moment. Pure.
 * `phaseElapsed` / `dataElapsed`: seconds since the phase / the latest data began.
 */
export function phasePercent(input: {
  phase: Phase;
  data?: ProgressData;
  summaryPath?: SummaryPath;
  phaseElapsed: number;
  dataElapsed: number;
}): number {
  const { phase, data, phaseElapsed, dataElapsed } = input;
  switch (phase) {
    case 'queued':
      return 0;
    case 'captions':
      return CAPTIONS_END * 0.9 * creep(phaseElapsed, 4);
    case 'download':
      return hasTotal(data)
        ? DOWNLOAD_END * clamp01(data.done / data.total)
        : DOWNLOAD_CREEP_CAP * creep(phaseElapsed, 25);
    case 'extract':
      return DOWNLOAD_END;
    case 'transcription': {
      const span = TRANSCRIBE_END - DOWNLOAD_END;
      if (!hasTotal(data)) return DOWNLOAD_END + (span - 1) * creep(phaseElapsed, 120);
      // Inside the current chunk, creep toward (90% of) its end boundary.
      const until =
        typeof data.until === 'number' && data.until > data.done ? data.until : data.done;
      const effective = data.done + (until - data.done) * 0.9 * creep(dataElapsed, 20);
      return DOWNLOAD_END + span * clamp01(effective / data.total);
    }
    case 'summary': {
      const path = input.summaryPath ?? 'video';
      const base = SUMMARY_BASE[path];
      return base + (SUMMARY_CAP - base) * creep(phaseElapsed, SUMMARY_TAU_S[path]);
    }
    case 'done':
      return 100;
  }
}

/**
 * Rate-based ETA with an EMA of the progress rate. Returns null until the rate
 * has been stable for a few samples — an absurd estimate is worse than none.
 */
export function createEtaEstimator(
  options: { minIntervalMs?: number; maxEtaSeconds?: number } = {},
) {
  const minInterval = options.minIntervalMs ?? 2000;
  const maxEta = options.maxEtaSeconds ?? 4 * 3600;
  let lastT = -1;
  let lastV = 0;
  let ema = 0;
  let stable = 0;
  let samples = 0;
  return {
    reset(): void {
      lastT = -1;
      ema = 0;
      stable = 0;
      samples = 0;
    },
    /** Feeds `value` (monotonic progress) at `nowMs`; ETA in seconds to reach `target`, or null. */
    sample(nowMs: number, value: number, target: number): number | null {
      if (lastT < 0) {
        lastT = nowMs;
        lastV = value;
        return null;
      }
      const dt = nowMs - lastT;
      if (dt >= minInterval) {
        const rate = (value - lastV) / (dt / 1000);
        lastT = nowMs;
        lastV = value;
        if (rate > 0) {
          if (samples === 0) {
            ema = rate;
          } else {
            const ratio = rate / ema;
            stable = ratio >= 0.5 && ratio <= 2 ? stable + 1 : 0;
            ema = 0.3 * rate + 0.7 * ema;
          }
          samples++;
        } else {
          stable = 0;
        }
      }
      if (stable < 2 || ema <= 0) return null;
      const eta = (target - value) / ema;
      return eta > 0 && eta <= maxEta ? Math.round(eta) : null;
    },
  };
}

/** Minimum overall percentage before any ETA is shown. */
export const ETA_MIN_PERCENT = 10;

export interface ProgressTracker {
  /** Enters a phase (same phase again = new data for it). */
  set(phase: Exclude<Phase, 'done'>, data?: ProgressData): void;
  /** Summary phase of the given path (decides its starting percentage). */
  beginSummary(path: SummaryPath): void;
  /** Current monotonic snapshot (recomputes the creeping phases). */
  snapshot(): JobPercent;
  done(): JobPercent;
}

export function createProgressTracker(now: () => number = Date.now): ProgressTracker {
  let phase: Phase = 'captions';
  let data: ProgressData | undefined;
  let summaryPath: SummaryPath = 'video';
  const t0 = now();
  let phaseStart = t0;
  let dataStart = t0;
  let last = 0;
  const eta = createEtaEstimator();

  const enter = (next: Phase, nextData?: ProgressData) => {
    const t = now();
    if (next !== phase) {
      phase = next;
      phaseStart = t;
      eta.reset();
    }
    if (nextData?.done !== data?.done || nextData?.total !== data?.total) dataStart = t;
    data = nextData;
  };

  const snapshot = (): JobPercent => {
    const t = now();
    const raw =
      phase === 'done'
        ? 100
        : phasePercent({
            phase,
            data,
            summaryPath,
            phaseElapsed: (t - phaseStart) / 1000,
            dataElapsed: (t - dataStart) / 1000,
          });
    last = phase === 'done' ? 100 : Math.max(last, Math.min(MAX_BEFORE_DONE, raw));
    const out: JobPercent = { percent: Math.round(last), phase };
    if (data) {
      if (data.done != null) out.done = data.done;
      if (data.total != null) out.total = data.total;
      if (data.unit) out.unit = data.unit;
      if (data.ahead != null) out.ahead = data.ahead;
    }
    // ETA only where the progress is measured, never while creeping.
    if (phase === 'transcription' && hasTotal(data) && last >= ETA_MIN_PERCENT) {
      const remaining = eta.sample(t, last, TRANSCRIBE_END);
      // + a flat allowance for the summary that follows.
      if (remaining != null) out.etaSeconds = remaining + 20;
    }
    return out;
  };

  return {
    set: (p, d) => enter(p, d),
    beginSummary(path) {
      summaryPath = path;
      enter('summary');
    },
    snapshot,
    done() {
      phase = 'done';
      return snapshot();
    },
  };
}
