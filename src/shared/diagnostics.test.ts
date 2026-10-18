import { describe, expect, it } from 'vitest';
import type { JobsSnapshot } from '@/background/job-store';
import { DEFAULT_SETTINGS } from '@/types';
import type { Settings } from '@/types';
import type { LogEntry } from './logger';
import type { BuildInfo } from './diagnostics';
import { buildReport } from './diagnostics';

const SECRET = 'sk-or-v1-secret';
const OTHER_SECRET = 'sk-or-v1-othersecret';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const build: BuildInfo = { version: '0.2.0', sha: 'd338ebe', date: '2026-10-17T09:00:00.000Z' };

const manifest = { name: 'tldw — Video Summaries', version: '0.2.0', manifest_version: 3 };

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  openRouterKey: SECRET,
  transcriptionKey: OTHER_SECRET,
};

const jobs: JobsSnapshot = {
  lastJobId: 'video-running',
  jobs: {
    'video-running': {
      phase: 'running',
      videoId: 'video-running',
      steps: [
        { videoId: 'video-running', step: 'detect', status: 'done' },
        {
          videoId: 'video-running',
          step: 'captions',
          status: 'active',
          detail: '3 min 20 / 12 min',
        },
      ],
    },
    'video-done': {
      phase: 'done',
      videoId: 'video-done',
      summary: {
        videoId: 'video-done',
        title: 'How to build an extension',
        provider: 'youtube',
        durationLabel: '12 min 03',
        transcriptSource: 'youtube_captions',
        createdAt: '2026-10-17T10:00:00.000Z',
        locale: 'en',
        detailLevel: 'standard',
        model: 'google/gemini-2.5-flash',
        content: {
          tldr: 'CANARY-TLDR',
          keyPoints: ['CANARY-KEYPOINT'],
          sections: [{ heading: 'CANARY-HEADING', body: 'CANARY-BODY' }],
          glossary: [],
          takeaways: [],
        },
        markdown: 'CANARY-MARKDOWN',
      },
    },
    'video-error': {
      phase: 'error',
      videoId: 'video-error',
      code: 'SUMMARY_API_ERROR',
      message: 'Generating the summary failed.',
      detail: `HTTP 429 for key=${SECRET}`,
    },
  },
};

const logs: LogEntry[] = [
  { t: 1760000000000, level: 'info', source: 'sw', msg: 'job started (youtube)' },
  {
    t: 1760000001000,
    level: 'error',
    source: 'offscreen',
    msg: `transcription failed for ${SECRET}`,
    data: { apiKey: 'raw-zzz', note: 'kept' },
  },
];

const fullReport = (): string =>
  buildReport({ manifest, build, userAgent: USER_AGENT, settings, jobs, logs });

describe('buildReport', () => {
  it('never leaks the keys, the raw log payloads or the summary content', () => {
    const out = fullReport();
    expect(out).not.toContain('sk-or');
    expect(out).not.toContain('raw-zzz');
    expect(out).not.toContain('CANARY');
  });

  it('reports each settings key as presence only', () => {
    const out = fullReport();
    expect(out).toContain('openRouterKey: present: yes');
    expect(out).toContain('transcriptionKey: present: yes');
  });

  it('reports empty settings keys as absent', () => {
    const out = buildReport({
      settings: { ...DEFAULT_SETTINGS, openRouterKey: '', transcriptionKey: '' },
    });
    expect(out).toContain('openRouterKey: present: no');
    expect(out).toContain('transcriptionKey: present: no');
  });

  it('renders the non-secret settings values', () => {
    const out = fullReport();
    expect(out).toContain('summaryModel: google/gemini-3.1-flash-lite');
    expect(out).toContain('theme: system');
    expect(out).toContain('onboarded: false');
    expect(out).toContain('timeoutSeconds: 900');
  });

  it('identifies the extension, the build and the environment', () => {
    const out = fullReport();
    expect(out).toContain('Name: tldw — Video Summaries');
    expect(out).toContain('Version: 0.2.0');
    expect(out).toContain('Manifest version: 3');
    expect(out).toContain('Commit: d338ebe');
    expect(out).toContain('Date: 2026-10-17T09:00:00.000Z');
    expect(out).toContain(`User agent: ${USER_AGENT}`);
  });

  it('snapshots the jobs without their transcript or summary content', () => {
    const out = fullReport();
    expect(out).toContain('- Last job: video-running');
    expect(out).toContain('- video-running: running');
    expect(out).toContain('Steps: detect: done, captions: active (3 min 20 / 12 min)');
    expect(out).toContain('- video-done: done');
    expect(out).toContain('Title: How to build an extension');
    expect(out).toContain('Model: google/gemini-2.5-flash');
    expect(out).toContain('- video-error: error (SUMMARY_API_ERROR)');
    expect(out).toContain('Message: Generating the summary failed.');
  });

  it('redacts log lines that reached the buffer unredacted', () => {
    const out = fullReport();
    expect(out).toContain('[sw] INFO: job started (youtube)');
    expect(out).toContain('transcription failed for [REDACTED]');
    expect(out).toContain('{"apiKey":"[REDACTED]","note":"kept"}');
  });

  it('keeps only the last 50 log lines', () => {
    const entries: LogEntry[] = Array.from({ length: 60 }, (_, i) => ({
      t: 1700000000000 + i,
      level: 'info',
      source: 'sw',
      msg: `e-${i}-end`,
    }));
    const out = buildReport({ logs: entries });
    expect(out).toContain('## Logs (last 50 of 60)');
    expect(out).toContain('e-59-end');
    expect(out).toContain('e-10-end');
    expect(out).not.toContain('e-9-end');
    expect(out).not.toContain('e-0-end');
  });

  it('degrades to (none) placeholders instead of throwing on missing pieces', () => {
    const out = buildReport({});
    for (const section of [
      '## Extension',
      '## Build',
      '## Environment',
      '## Settings',
      '## Jobs',
      '## Logs',
    ]) {
      expect(out).toContain(section);
    }
    expect(out).toContain('- (none)');
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('null');
  });

  it('shows the unknown-sha fallback verbatim', () => {
    expect(buildReport({ build: { ...build, sha: 'unknown' } })).toContain('Commit: unknown');
  });

  it('redacts on copies — the inputs keep their raw values', () => {
    fullReport();
    expect(settings.openRouterKey).toBe(SECRET);
    expect(logs[1].msg).toContain(SECRET);
    expect(logs[1].data).toEqual({ apiKey: 'raw-zzz', note: 'kept' });
    const errorJob = jobs.jobs['video-error'];
    if (errorJob?.phase === 'error') expect(errorJob.detail).toContain(SECRET);
  });

  it('opens with a stamped title', () => {
    expect(fullReport()).toMatch(
      /^# tldw diagnostic report\n\nGenerated: \d{4}-\d{2}-\d{2}T[\d:.]+Z\n\n## Extension/,
    );
  });
});
