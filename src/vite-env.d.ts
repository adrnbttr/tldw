/// <reference types="vite/client" />

import type { BuildInfo } from './shared/diagnostics';

/**
 * Build identity injected at build time by Vite `define` (see vite.config.ts):
 * package version, short git sha of HEAD — 'unknown' when git is unavailable —
 * and ISO-8601 build date.
 *
 * The constant only exists in Vite-processed bundles (build and dev server);
 * tests never see it. Read it only where it is guaranteed to exist and pass it
 * down as a parameter — `buildReport` in src/shared/diagnostics.ts takes
 * `build` as an input for exactly that reason.
 */
declare global {
  const __TLDW_BUILD__: BuildInfo;
}
