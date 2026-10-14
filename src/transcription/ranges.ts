/**
 * Byte-range planning for progressive downloads (F5.x).
 *
 * Pure math, no DOM/fetch: given a total byte count and a block size, produce
 * the inclusive `bytes=a-b` HTTP ranges covering the whole file. Kept free of
 * any browser API so it stays unit-testable in Node.
 */

/**
 * Plans the inclusive byte ranges (`bytes=a-b`) that cover `totalBytes` bytes
 * downloaded in `blockSize` chunks. The last range is truncated to the total.
 *
 * - `totalBytes <= 0` → `[]` (nothing to download).
 * - `blockSize <= 0` → throws `RangeError`: a non-positive block size is a
 *   programming error, not a download condition.
 */
export function planByteRanges(totalBytes: number, blockSize: number): Array<[number, number]> {
  if (totalBytes <= 0) return [];
  if (blockSize <= 0) {
    throw new RangeError(`blockSize must be positive, got ${blockSize}`);
  }
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < totalBytes; start += blockSize) {
    ranges.push([start, Math.min(start + blockSize, totalBytes) - 1]);
  }
  return ranges;
}
