import { describe, it, expect } from 'vitest';
import { planChunks, mergeChunkTranscripts, assembleChunkSegments } from './chunker';

describe('planChunks', () => {
  it('returns a single chunk when the audio fits', () => {
    const plans = planChunks({ durationSeconds: 600, bytesPerSecond: 8000 });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({ index: 0, start: 0, end: 600 });
  });

  it('splits long audio with overlap', () => {
    // 24 MB / 8000 B/s = 3000 s per chunk; 7000 s total → 3 chunks.
    const plans = planChunks({ durationSeconds: 7000, bytesPerSecond: 8000, overlapSeconds: 5 });
    expect(plans.length).toBeGreaterThan(1);
    // Consecutive chunks overlap by exactly overlapSeconds.
    expect(plans[1].start).toBe(plans[0].end - 5);
    // Coverage reaches the end.
    expect(plans[plans.length - 1].end).toBe(7000);
  });

  it('handles degenerate input', () => {
    expect(planChunks({ durationSeconds: 0, bytesPerSecond: 8000 })).toEqual([]);
    expect(planChunks({ durationSeconds: 100, bytesPerSecond: 0 })).toEqual([]);
  });

  it('caps chunks at ~12 minutes by default (1 h audio)', () => {
    const plans = planChunks({ durationSeconds: 3600, bytesPerSecond: 8000, overlapSeconds: 0 });
    expect(plans).toHaveLength(5);
    for (const p of plans) {
      expect(p.end - p.start).toBeLessThanOrEqual(720);
    }
    // Coverage is exact: 5 × 720 s = 3600 s, no gaps.
    expect(plans[plans.length - 1].end).toBe(3600);
    expect(plans.map((p) => p.start)).toEqual([0, 720, 1440, 2160, 2880]);
  });

  it('honors an explicit maxChunkSeconds', () => {
    const plans = planChunks({
      durationSeconds: 3600,
      bytesPerSecond: 8000,
      overlapSeconds: 0,
      maxChunkSeconds: 600,
    });
    for (const p of plans) {
      expect(p.end - p.start).toBeLessThanOrEqual(600);
    }
    expect(plans[plans.length - 1].end).toBe(3600);
  });

  it('still respects the byte cap when it is tighter', () => {
    // 1.6 MB / 8000 B/s = 200 s < the 720 s time cap.
    const plans = planChunks({
      durationSeconds: 1000,
      bytesPerSecond: 8000,
      overlapSeconds: 0,
      maxBytes: 1_600_000,
    });
    expect(plans).toHaveLength(5);
    for (const p of plans) {
      expect(p.end - p.start).toBeLessThanOrEqual(200);
    }
  });
});

describe('assembleChunkSegments', () => {
  it('keeps chunk order regardless of completion order', () => {
    const chunks = planChunks({ durationSeconds: 3600, bytesPerSecond: 8000, overlapSeconds: 0 });
    // Chunks complete in reverse order (worst-case concurrency), one fails.
    const texts: Array<string | undefined> = [];
    for (const c of [...chunks].reverse()) texts[c.index] = `t${c.index}`;
    texts[2] = undefined;

    const segments = assembleChunkSegments(chunks, texts);
    expect(segments.map((s) => s.text)).toEqual(['t0', 't1', 't3', 't4']);
    expect(segments[1]).toMatchObject({ start: chunks[1].start, end: chunks[1].end });
  });

  it('trims and drops empty texts', () => {
    const chunks = planChunks({ durationSeconds: 600, bytesPerSecond: 8000 });
    const segments = assembleChunkSegments(chunks, ['  hello  ', '']);
    expect(segments).toEqual([{ start: 0, end: 600, text: 'hello' }]);
  });
});

describe('mergeChunkTranscripts', () => {
  it('offsets timings and drops overlap duplicates', () => {
    const merged = mergeChunkTranscripts(
      [
        [
          { start: 0, end: 4, text: 'a' },
          { start: 4, end: 8, text: 'b' },
        ],
        [
          // overlaps the previous chunk's tail (absolute 6..8) then continues
          { start: 0, end: 2, text: 'b-dup' },
          { start: 2, end: 6, text: 'c' },
        ],
      ],
      [0, 6],
    );
    expect(merged.map((s) => s.text)).toEqual(['a', 'b', 'c']);
    expect(merged[2]).toMatchObject({ start: 8, end: 12 });
  });
});
