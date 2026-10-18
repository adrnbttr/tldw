import { describe, expect, it } from 'vitest';
import type { DetectedVideo, JobState } from '@/types';
import { videoKey } from '@/shared/video-key';
import { batchFinished, batchProgress } from './batch';

const video = (id: string): DetectedVideo =>
  ({ id, provider: 'youtube', externalId: `ext-${id}`, title: id }) as DetectedVideo;
const running = (id: string): JobState => ({ phase: 'running', videoId: id, steps: [] });
const failed = (id: string): JobState => ({
  phase: 'error',
  videoId: id,
  code: 'TIMEOUT',
  message: 'x',
});
const done = (id: string): JobState =>
  ({ phase: 'done', videoId: id, summary: {} }) as unknown as JobState;

const [a, b, c] = [video('a'), video('b'), video('c')];
const videos = [a, b, c];

describe('batchProgress', () => {
  it('is hidden for videos started one by one (no batch launched)', () => {
    expect(batchProgress(videos, { a: running('a'), b: running('b') }, [])).toBeNull();
  });

  it('counts only the batch videos, finished ones as settled', () => {
    const keys = [videoKey(a), videoKey(b)];
    expect(batchProgress(videos, { a: done('a'), b: running('b'), c: running('c') }, keys)).toEqual(
      { settled: 1, total: 2 },
    );
    expect(batchProgress(videos, { a: failed('a'), b: running('b') }, keys)).toEqual({
      settled: 1,
      total: 2,
    });
  });

  it('counts a batch video with no state yet as pending', () => {
    expect(batchProgress(videos, {}, [videoKey(a), videoKey(b)])).toEqual({
      settled: 0,
      total: 2,
    });
  });

  it('matches videos by stable key across re-scans (fresh local ids)', () => {
    const rescanned = [
      { ...a, id: 'a2' },
      { ...b, id: 'b2' },
    ];
    expect(batchProgress(rescanned, { a2: running('a2') }, [videoKey(a), videoKey(b)])).toEqual({
      settled: 0,
      total: 2,
    });
  });

  it('is hidden once everything settled, or for fewer than two listed batch videos', () => {
    const keys = [videoKey(a), videoKey(b)];
    expect(batchProgress(videos, { a: done('a'), b: failed('b') }, keys)).toBeNull();
    expect(batchProgress([a], { a: running('a') }, keys)).toBeNull();
  });
});

describe('batchFinished', () => {
  const keys = [videoKey(a), videoKey(b)];
  it('is true once every listed batch video is done or failed', () => {
    expect(batchFinished(videos, { a: done('a'), b: failed('b') }, keys)).toBe(true);
    expect(batchFinished(videos, { a: done('a'), b: running('b') }, keys)).toBe(false);
    expect(batchFinished(videos, { a: done('a') }, keys)).toBe(false);
  });

  it('keeps the batch while the list is loading or shows another page', () => {
    expect(batchFinished([], {}, keys)).toBe(false);
    expect(batchFinished([c], { c: done('c') }, keys)).toBe(false);
    expect(batchFinished(videos, {}, [])).toBe(false);
  });
});
