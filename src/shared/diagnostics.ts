import type { JobsSnapshot } from '@/background/job-store';
import type { JobProgress, JobState, Settings } from '@/types';
import type { LogEntry } from './logger';
import { redact, redactString } from './logger';

/**
 * Diagnostic report assembly: everything worth pasting into a bug report —
 * manifest identity, build stamp, user agent, settings, job snapshot and the
 * recent log lines — folded into a single Markdown document (copied or
 * downloaded from the popup's Diagnostic section).
 *
 * Pure by construction: no `chrome` access, every piece arrives as a
 * parameter, so tests drive it with plain fixtures while the service worker
 * gathers the real values. Every input is optional — a piece that could not
 * be collected renders as `(none)` instead of breaking the whole report.
 *
 * The report is meant to be pasted into a conversation, so nothing that could
 * carry a secret is ever rendered verbatim: secret-sounding settings appear as
 * presence only, and every free-text field (log lines, error details, video
 * titles) is re-redacted through the logger — the buffer is never trusted to
 * have redacted itself.
 */

/** Build identity injected at build time as `__TLDW_BUILD__` (see vite.config.ts). */
export interface BuildInfo {
  /** package.json version the bundle was built from. */
  version: string;
  /** Short sha of HEAD at build time — 'unknown' when git was unavailable. */
  sha: string;
  /** ISO-8601 build date. */
  date: string;
}

/** The manifest fields worth reporting — a subset of `chrome.runtime.getManifest()`. */
export interface ManifestInfo {
  name?: string;
  version?: string;
  manifest_version?: number;
}

/** Everything the report needs, gathered by the caller; all optional. */
export interface ReportInput {
  manifest?: ManifestInfo | null;
  build?: BuildInfo | null;
  userAgent?: string | null;
  settings?: Settings | null;
  /** The orchestrator's persisted snapshot (src/background/job-store.ts). */
  jobs?: JobsSnapshot | null;
  logs?: readonly LogEntry[];
}

/** Log lines kept in the report — the buffer holds 500, the report must stay pasteable. */
const MAX_LOG_LINES = 50;

const NONE = '(none)';

/**
 * Presence-only setting names. Same spirit as the logger's secret-field rules
 * (src/shared/logger.ts), matched anywhere in the name so a future
 * secret-bearing setting can never leak just by being added.
 */
const SECRET_SETTING = /(key|token|secret|password|passphrase|credential)/i;

/** Builds the full Markdown diagnostic report, section by section. */
export function buildReport(input: ReportInput): string {
  const sections = [
    headerSection(),
    extensionSection(input.manifest),
    buildSection(input.build),
    environmentSection(input.userAgent),
    settingsSection(input.settings),
    jobsSection(input.jobs),
    logsSection(input.logs ?? []),
  ];
  return `${sections.join('\n\n')}\n`;
}

function headerSection(): string {
  return `# tldw diagnostic report\n\nGenerated: ${new Date().toISOString()}`;
}

function extensionSection(manifest: ManifestInfo | null | undefined): string {
  const lines = ['## Extension'];
  if (manifest?.name) lines.push(`- Name: ${manifest.name}`);
  if (manifest?.version) lines.push(`- Version: ${manifest.version}`);
  if (manifest?.manifest_version != null)
    lines.push(`- Manifest version: ${manifest.manifest_version}`);
  if (lines.length === 1) lines.push(`- ${NONE}`);
  return lines.join('\n');
}

function buildSection(build: BuildInfo | null | undefined): string {
  if (!build) return `## Build\n- ${NONE}`;
  return [
    '## Build',
    `- Version: ${build.version}`,
    `- Commit: ${build.sha}`,
    `- Date: ${build.date}`,
  ].join('\n');
}

function environmentSection(userAgent: string | null | undefined): string {
  return `## Environment\n- User agent: ${userAgent ?? NONE}`;
}

function settingsSection(settings: Settings | null | undefined): string {
  const lines = ['## Settings'];
  if (!settings) {
    lines.push(`- ${NONE}`);
    return lines.join('\n');
  }
  for (const [name, value] of Object.entries(settings)) {
    if (SECRET_SETTING.test(name)) {
      const present = typeof value === 'string' && value.length > 0;
      lines.push(`- ${name}: present: ${present ? 'yes' : 'no'}`);
    } else {
      lines.push(`- ${name}: ${renderValue(value)}`);
    }
  }
  return lines.join('\n');
}

/** Scalars as-is (strings redacted), objects as JSON — never throws on oddballs. */
function renderValue(value: unknown): string {
  if (value == null) return NONE;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'object') {
    try {
      return redactString(JSON.stringify(redact(value)));
    } catch {
      return '[unserializable]';
    }
  }
  return String(value);
}

function jobsSection(jobs: JobsSnapshot | null | undefined): string {
  const lines = ['## Jobs'];
  if (!jobs) {
    lines.push(`- ${NONE}`);
    return lines.join('\n');
  }
  lines.push(`- Last job: ${jobs.lastJobId ?? NONE}`);
  const entries = Object.entries(jobs.jobs);
  if (entries.length === 0) lines.push(`- ${NONE}`);
  for (const [videoId, state] of entries) lines.push(...jobLines(videoId, state));
  return lines.join('\n');
}

/**
 * One job = a phase line plus the details that identify it — never its
 * transcript or full summary content.
 */
function jobLines(videoId: string, state: JobState): string[] {
  switch (state.phase) {
    case 'idle':
      return [`- ${videoId}: idle`];
    case 'running':
      return [`- ${videoId}: running`, `  - Steps: ${state.steps.map(stepLine).join(', ')}`];
    case 'done':
      return [
        `- ${videoId}: done`,
        `  - Title: ${redactString(state.summary.title)}`,
        `  - Provider: ${state.summary.provider}`,
        `  - Transcript source: ${state.summary.transcriptSource}`,
        `  - Model: ${state.summary.model}`,
        `  - Created at: ${state.summary.createdAt}`,
      ];
    case 'error':
      return [
        `- ${videoId}: error (${state.code})`,
        `  - Message: ${redactString(state.message)}`,
        ...(state.detail ? [`  - Detail: ${redactString(state.detail)}`] : []),
      ];
    default: {
      // A snapshot restored from storage can hold a state this build doesn't
      // know — surface the raw phase instead of crashing the whole report.
      const phase = (state as { phase?: string } | undefined)?.phase;
      return [`- ${videoId}: ${phase ?? 'unknown'}`];
    }
  }
}

function stepLine(step: JobProgress): string {
  const detail = step.detail ? ` (${redactString(step.detail)})` : '';
  return `${step.step}: ${step.status}${detail}`;
}

function logsSection(logs: readonly LogEntry[]): string {
  const tail = logs.slice(-MAX_LOG_LINES);
  const heading =
    logs.length > MAX_LOG_LINES ? `## Logs (last ${MAX_LOG_LINES} of ${logs.length})` : '## Logs';
  const lines = [heading];
  if (tail.length === 0) lines.push(`- ${NONE}`);
  for (const entry of tail) lines.push(logLine(entry));
  return lines.join('\n');
}

/** Re-redacted on the way out — the buffer is never trusted. */
function logLine(entry: LogEntry): string {
  const safe = redact(entry) as LogEntry;
  const level = safe.level.toUpperCase();
  const data = safe.data === undefined ? '' : ` — ${renderValue(safe.data)}`;
  const head = `- ${isoTime(safe.t)} [${safe.source}] ${level}: ${redactString(safe.msg)}`;
  return data ? `${head}${data}` : head;
}

/** ISO timestamp, degrading instead of throwing on a malformed `t`. */
function isoTime(t: number): string {
  const date = new Date(t);
  return Number.isNaN(date.getTime()) ? String(t) : date.toISOString();
}
