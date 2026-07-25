import { describe, it, expect } from 'vitest';
import { planChunks, mergeChunkTranscripts } from './chunker';

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
