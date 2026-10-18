import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { OffscreenResponse, TranscribeJob } from './offscreen-protocol';
import {
  MEDIA_INACTIVITY_SECONDS,
  mediaBudgetSeconds,
  runInOffscreen,
  transcriptionTimeoutSeconds,
} from './index';

describe('transcriptionTimeoutSeconds', () => {
  it('extends the base proportionally to the duration', () => {
    expect(transcriptionTimeoutSeconds(3600, 900)).toBe(4500);
  });

  it('caps at 4 hours', () => {
    expect(transcriptionTimeoutSeconds(36000, 900)).toBe(14400);
  });

  it('falls back to the base for missing or invalid durations', () => {
    expect(transcriptionTimeoutSeconds(null, 900)).toBe(900);
    expect(transcriptionTimeoutSeconds(-5, 900)).toBe(900);
    expect(transcriptionTimeoutSeconds(Number.NaN, 900)).toBe(900);
  });

  it('falls back to the default base (15 min) for an invalid base, never 0', () => {
    expect(transcriptionTimeoutSeconds(600, -1)).toBe(900 + 600);
    expect(transcriptionTimeoutSeconds(null, Number.NaN)).toBe(900);
  });
});

describe('mediaBudgetSeconds', () => {
  it("follows the user's timeout, never below 10 min", () => {
    expect(mediaBudgetSeconds(3600)).toBe(3600);
    expect(mediaBudgetSeconds(120)).toBe(600);
    expect(mediaBudgetSeconds(Number.NaN)).toBe(600);
  });
});

describe('runInOffscreen budgets', () => {
  let listeners: Array<(msg: OffscreenResponse, sender?: unknown) => void>;
  const job = { jobId: 'run-1', videoId: 'v' } as TranscribeJob;

  const emit = (
    msg: OffscreenResponse,
    sender: unknown = { id: 'ext', url: 'chrome-extension://ext/src/offscreen/offscreen.html' },
  ) => [...listeners].forEach((l) => l(msg, sender));
  const progress = (phase: 'download' | 'extract' | 'transcribe', duration?: number) =>
    emit({ type: 'OFFSCREEN_PROGRESS', jobId: 'run-1', phase, detail: 'x', duration });

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = [];
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'ext',
        onMessage: {
          addListener: (l: (msg: OffscreenResponse, sender?: unknown) => void) => listeners.push(l),
          removeListener: (l: (msg: OffscreenResponse, sender?: unknown) => void) =>
            (listeners = listeners.filter((x) => x !== l)),
        },
        sendMessage: vi.fn(async () => undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fails a download that stalls, but not one that keeps moving', async () => {
    const p = runInOffscreen(job, vi.fn(), 900);
    const settled = vi.fn();
    p.catch(settled);
    // Progress every 100 s keeps re-arming the 120 s inactivity timer.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100_000);
      progress('download');
    }
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MEDIA_INACTIVITY_SECONDS * 1000 + 1);
    await expect(p).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringMatching(/stalled/),
    });
  });

  it('caps the whole download phase at max(user timeout, 10 min)', async () => {
    const p = runInOffscreen(job, vi.fn(), 1200);
    const settled = vi.fn();
    p.catch(settled);
    for (let t = 0; t < 1190; t += 60) {
      await vi.advanceTimersByTimeAsync(60_000);
      progress('download');
    }
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(p).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: expect.stringMatching(/exceeded/),
    });
  });

  it('switches to the duration-proportional budget once transcription starts', async () => {
    const onProgress = vi.fn();
    const p = runInOffscreen(job, onProgress, 900);
    const settled = vi.fn();
    p.catch(settled);
    progress('extract');
    progress('transcribe', 3600);
    // No progress for 30 min: the media inactivity/cap timers are gone, the
    // transcription budget is 900 + 3600 s.
    await vi.advanceTimersByTimeAsync(4400_000);
    expect(settled).not.toHaveBeenCalled();
    emit({ type: 'OFFSCREEN_RESULT', jobId: 'run-1', ok: true, segments: [] });
    await expect(p).resolves.toEqual({ language: undefined, segments: [] });
    expect(onProgress).toHaveBeenCalledWith('x', 'transcribe', undefined);
  });

  it('times out the transcription phase at its budget', async () => {
    const p = runInOffscreen(job, vi.fn(), 900);
    const settled = expect(p).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'Transcription exceeded the time limit.',
    });
    progress('transcribe', 100);
    await vi.advanceTimersByTimeAsync(1000_001);
    await settled;
  });

  it("ignores another run's messages", async () => {
    const p = runInOffscreen(job, vi.fn(), 900);
    const settled = vi.fn();
    p.then(settled, settled);
    emit({ type: 'OFFSCREEN_RESULT', jobId: 'other', ok: true, segments: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    emit({ type: 'OFFSCREEN_RESULT', jobId: 'run-1', ok: false, code: 'UNKNOWN', message: 'm' });
    await expect(p).rejects.toMatchObject({ code: 'UNKNOWN', providerMessage: 'm' });
  });
});
