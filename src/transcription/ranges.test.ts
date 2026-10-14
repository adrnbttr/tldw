import { describe, it, expect } from 'vitest';
import { planByteRanges } from './ranges';

describe('planByteRanges', () => {
  it('returns no ranges for a zero or negative total', () => {
    expect(planByteRanges(0, 1024)).toEqual([]);
    expect(planByteRanges(-5, 1024)).toEqual([]);
  });

  it('covers an exact multiple of the block size', () => {
    expect(planByteRanges(80, 40)).toEqual([
      [0, 39],
      [40, 79],
    ]);
  });

  it('truncates the last range when the total is not a multiple', () => {
    expect(planByteRanges(100, 40)).toEqual([
      [0, 39],
      [40, 79],
      [80, 99],
    ]);
  });

  it('returns a single truncated range when the total is smaller than a block', () => {
    expect(planByteRanges(30, 40)).toEqual([[0, 29]]);
  });

  it('returns a single one-byte range for a one-byte file', () => {
    expect(planByteRanges(1, 40)).toEqual([[0, 0]]);
  });

  it('throws a RangeError on a zero or negative block size', () => {
    expect(() => planByteRanges(100, 0)).toThrow(RangeError);
    expect(() => planByteRanges(100, -8)).toThrow(/blockSize/);
  });

  it('returns [] for an empty total even with an invalid block size', () => {
    // Nothing to download: the total check short-circuits before blockSize.
    expect(planByteRanges(0, 0)).toEqual([]);
  });

  it('plans 8 MiB blocks for a 20 MiB file', () => {
    const mib = 1024 * 1024;
    const block = 8 * mib;
    const ranges = planByteRanges(20 * mib, block);
    expect(ranges).toHaveLength(3);
    expect(ranges[0]).toEqual([0, block - 1]);
    expect(ranges[2]).toEqual([2 * block, 20 * mib - 1]);
  });
});
