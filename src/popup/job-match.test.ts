import { describe, expect, it } from 'vitest';
import type { DetectedVideo, JobState } from '@/types';
import { matchJobs } from './job-match';

const video = (id: string, externalId = 'F1'): DetectedVideo => ({
  id,
  provider: 'drive',
  externalId,
  title: null,
  duration: null,
  iframeSrc: null,
  mediaSrc: null,
  isPlaying: false,
});

const running = (videoId: string): JobState => ({ phase: 'running', videoId, steps: [] });
const interrupted = (videoId: string): JobState => ({
  phase: 'error',
  videoId,
  code: 'INTERRUPTED',
  message: 'm',
});

describe('matchJobs', () => {
  it('shows a job on its video after a re-scan gave the video a new local id', () => {
    const out = matchJobs(
      [video('new-id')],
      { 'old-id': running('old-id') },
      { 'old-id': 'drive:F1' },
    );
    expect(out['new-id']).toEqual(running('old-id'));
  });

  it('shows an INTERRUPTED job restored from the worker', () => {
    const out = matchJobs([video('v')], { j: interrupted('j') }, { j: 'drive:F1' });
    expect(out.v).toMatchObject({ code: 'INTERRUPTED' });
  });

  it('prefers the running job over a stale terminal one', () => {
    const out = matchJobs(
      [video('v')],
      { v: interrupted('v'), j: running('j') },
      { v: 'drive:F1', j: 'drive:F1' },
    );
    expect(out.v.phase).toBe('running');
  });

  it('leaves other videos alone', () => {
    const out = matchJobs([video('v', 'OTHER')], { j: running('j') }, { j: 'drive:F1' });
    expect(out).toEqual({});
  });

  it('carries the progress of a matched running job', () => {
    const job: JobState = {
      phase: 'running',
      videoId: 'old-id',
      steps: [],
      progress: { percent: 63, phase: 'transcription' },
    };
    const out = matchJobs([video('new-id')], { 'old-id': job }, { 'old-id': 'drive:F1' });
    expect(out['new-id']).toMatchObject({ progress: { percent: 63 } });
  });
});
