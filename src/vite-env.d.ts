/// <reference types="vite/client" />

import type { BuildInfo } from './shared/diagnostics';

/**
 * Build identity injected at build time by Vite `define` (see vite.config.ts):
 * package version, short git sha of HEAD — 'unknown' when git is unavailable —
 * and ISO-8601 build date.
 *
 * The constant exists in Vite-processed code: bundles (build and dev server)
 * and vitest runs, which load vite.config.ts and so its `define`. It is still
 * absent in plain node, so read it only where it is guaranteed to exist (or
 * behind `typeof`) and pass it down as a parameter — `buildReport` in
 * src/shared/diagnostics.ts takes `build` as an input for exactly that reason.
 */
declare global {
  const __TLDW_BUILD__: BuildInfo;
}
