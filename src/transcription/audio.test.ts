import { describe, it, expect } from 'vitest';
import { MAX_MEDIA_BYTES, assertMediaSize, planAudioWindows, parseFfmpegDuration } from './audio';
import { TldwError } from '@/types';

describe('assertMediaSize', () => {
  it('accepts media up to the limit', () => {
    expect(() => assertMediaSize(0)).not.toThrow();
    expect(() => assertMediaSize(MAX_MEDIA_BYTES)).not.toThrow();
  });

  it('throws one byte over the limit', () => {
    let err: unknown;
    try {
      assertMediaSize(MAX_MEDIA_BYTES + 1);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TldwError);
    expect((err as TldwError).code).toBe('MEDIA_TOO_LARGE');
  });
});

describe('planAudioWindows', () => {
  it('returns a single window when the media fits', () => {
    // 3000 s × 8000 B/s = 24 MB → exactly one window.
    const windows = planAudioWindows({ durationSeconds: 3000, bytesPerSecond: 8000 });
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({ index: 0, start: 0, end: 3000 });
  });

  it('splits long media with overlap', () => {
    // 24 MB / 8000 B/s = 3145 s per window; 7000 s total → 3 windows.
    const windows = planAudioWindows({
      durationSeconds: 7000,
      bytesPerSecond: 8000,
      overlapSeconds: 5,
    });
    expect(windows.length).toBeGreaterThan(1);
    // Consecutive windows overlap by exactly overlapSeconds.
    expect(windows[1].start).toBe(windows[0].end - 5);
    // Coverage reaches the end.
    expect(windows[windows.length - 1].end).toBe(7000);
  });

  it('covers the tail without gaps and within the size limit', () => {
    const windows = planAudioWindows({ durationSeconds: 8000, bytesPerSecond: 8000 });
    expect(windows[0].start).toBe(0);
    expect(windows[windows.length - 1].end).toBe(8000);
    expect(windows[windows.length - 1].start).toBeGreaterThan(0);
    // No gap between consecutive windows, each under maxBytes.
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].start).toBeLessThanOrEqual(windows[i - 1].end);
    }
    for (const w of windows) {
      expect((w.end - w.start) * 8000).toBeLessThanOrEqual(24 * 1024 * 1024);
    }
  });

  it('supports zero overlap', () => {
    const windows = planAudioWindows({
      durationSeconds: 7000,
      bytesPerSecond: 8000,
      overlapSeconds: 0,
    });
    expect(windows[1].start).toBe(windows[0].end);
    expect(windows[windows.length - 1].end).toBe(7000);
  });

  it('handles degenerate input', () => {
    expect(planAudioWindows({ durationSeconds: 0, bytesPerSecond: 8000 })).toEqual([]);
    expect(planAudioWindows({ durationSeconds: 100, bytesPerSecond: 0 })).toEqual([]);
  });
});

describe('parseFfmpegDuration', () => {
  it('parses HH:MM:SS.xx from an ffmpeg log', () => {
    const log = 'Input #0, mov,mp4: Duration: 01:02:03.04, start: 0.000000, bitrate: 96 kb/s';
    expect(parseFfmpegDuration(log)).toBeCloseTo(3723.04);
  });

  it('returns null for N/A or missing duration', () => {
    expect(parseFfmpegDuration('  Duration: N/A, start: 0.000000')).toBeNull();
    expect(parseFfmpegDuration('no duration here')).toBeNull();
  });
});
