import { describe, expect, it } from 'vitest';
import type { BuildInfo, ManifestInfo } from '@/shared/diagnostics';
import type { LogEntry } from '@/shared/logger';
import { DEFAULT_SETTINGS } from '@/types';
import type { Settings } from '@/types';
import type { JobsSnapshot } from './job-store';
import { assembleDiagnosticsReport } from './diagnostics-handler';
import type { DiagnosticsSources } from './diagnostics-handler';

/**
 * The assembly is driven end-to-end with fixture collectors — no `chrome`, no
 * stores — so these tests pin what the `GET_DIAGNOSTICS` handler answers: the
 * report folds in every piece, and nothing the fixtures carry that smells
 * like a secret ever survives the trip.
 */

const SECRET = 'sk-or-v1-dontleakme';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const settings: Settings = { ...DEFAULT_SETTINGS, openRouterKey: SECRET };

const jobs: JobsSnapshot = {
  lastJobId: 'video-1',
  jobs: {
    'video-1': {
      phase: 'error',
      videoId: 'video-1',
      code: 'SUMMARY_API_ERROR',
      message: 'Generating the summary failed.',
      detail: `HTTP 429 for key=${SECRET}`,
    },
  },
};

const logs: LogEntry[] = [
  { t: 1760000000000, level: 'info', source: 'sw', msg: 'sw started' },
  {
    t: 1760000001000,
    level: 'error',
    source: 'offscreen',
    msg: `transcription failed for ${SECRET}`,
    data: { apiKey: SECRET, note: 'kept' },
  },
];

const manifest: ManifestInfo = {
  name: 'tldw — Video Summaries',
  version: '0.2.0',
  manifest_version: 3,
};

const build: BuildInfo = { version: '0.2.0', sha: 'd338ebe', date: '2026-10-17T09:00:00.000Z' };

const sources: DiagnosticsSources = {
  settings: async () => settings,
  jobs: () => jobs,
  logs: async () => logs,
  manifest: () => manifest,
  userAgent: () => USER_AGENT,
  build: () => build,
};

describe('assembleDiagnosticsReport', () => {
  it('folds every collected piece into the report', async () => {
    const report = await assembleDiagnosticsReport(sources);
    expect(report).toContain('Name: tldw — Video Summaries');
    expect(report).toContain('Version: 0.2.0');
    expect(report).toContain('Commit: d338ebe');
    expect(report).toContain(`User agent: ${USER_AGENT}`);
    expect(report).toContain('summaryModel: google/gemini-3.1-flash-lite');
    expect(report).toContain('- video-1: error (SUMMARY_API_ERROR)');
    expect(report).toContain('[sw] INFO: sw started');
    expect(report).toContain('[offscreen] ERROR: transcription failed for [REDACTED]');
    expect(report).toContain('{"apiKey":"[REDACTED]","note":"kept"}');
  });

  it('never includes the API key from the fixtures — settings, logs or job details', async () => {
    const report = await assembleDiagnosticsReport(sources);
    expect(report).not.toContain(SECRET);
    expect(report).not.toContain('sk-or');
    expect(report).toContain('openRouterKey: present: yes');
  });

  it('degrades a failing collector to (none) without failing the report', async () => {
    const report = await assembleDiagnosticsReport({
      ...sources,
      settings: () => {
        throw new Error('storage is gone');
      },
      logs: async () => {
        throw new Error('log read failed');
      },
    });
    expect(report).toContain('## Settings\n- (none)');
    expect(report).toContain('## Logs\n- (none)');
    // The rest of the report is still assembled from the healthy collectors.
    expect(report).toContain('Commit: d338ebe');
    expect(report).toContain('- video-1: error (SUMMARY_API_ERROR)');
  });
});
