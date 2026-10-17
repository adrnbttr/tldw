import type { BuildInfo, ManifestInfo } from '@/shared/diagnostics';
import { buildReport } from '@/shared/diagnostics';
import type { LogEntry } from '@/shared/logger';
import type { Settings } from '@/types';
import type { JobsSnapshot } from './job-store';

/**
 * Assembly glue for the `GET_DIAGNOSTICS` message.
 *
 * `buildReport` (src/shared/diagnostics.ts) is pure — no `chrome` anywhere,
 * every piece arrives as a parameter. This module is the bridge that feeds
 * it from the worker: each piece is an injected getter, so the unit test
 * drives the assembly with plain fixtures while src/background/index.ts
 * wires the real collectors — stored settings, the live job snapshot, the
 * log buffer, the manifest, the user agent and the build stamp.
 *
 * Collection is allowed to fail: a getter that throws degrades its piece to
 * `(none)` in the report instead of failing the whole request — a
 * diagnostics feature that errors out would be the worst kind of irony.
 */

/** The report's pieces, as lazy getters — invoked once per assembly. */
export interface DiagnosticsSources {
  /** Stored settings (chrome.storage.local, src/storage/index.ts). */
  settings(): Promise<Settings>;
  /** The orchestrator's live snapshot (src/background/orchestrator.ts). */
  jobs(): JobsSnapshot;
  /** The central log buffer (src/background/log-store.ts). */
  logs(): Promise<readonly LogEntry[]>;
  /** Manifest identity — a subset of `chrome.runtime.getManifest()` is enough. */
  manifest(): ManifestInfo;
  userAgent(): string;
  /** The build stamp injected by Vite `define` — null where it never was. */
  build(): BuildInfo | null;
}

/**
 * One collector, awaited; a throw degrades the piece to null so `buildReport`
 * renders `(none)` for it. Never rethrows.
 */
async function collect<T>(get: () => T): Promise<Awaited<T> | null> {
  try {
    return await get();
  } catch {
    // Piece unavailable — (none) in the report, the rest still assembled.
    return null;
  }
}

/**
 * Gathers every piece (in parallel) and folds it into the Markdown report.
 * Never rejects: the worst case is a report full of `(none)` placeholders.
 */
export async function assembleDiagnosticsReport(sources: DiagnosticsSources): Promise<string> {
  const [settings, jobs, logs, manifest, userAgent, build] = await Promise.all([
    collect(sources.settings),
    collect(sources.jobs),
    collect(sources.logs),
    collect(sources.manifest),
    collect(sources.userAgent),
    collect(sources.build),
  ]);
  // A failed log read renders as an empty buffer — `(none)` under ## Logs.
  return buildReport({ settings, jobs, manifest, userAgent, build, logs: logs ?? [] });
}
