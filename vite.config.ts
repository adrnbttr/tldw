/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import { fileURLToPath, URL } from 'node:url';
import pkg from './package.json';
import manifest from './manifest.config';

/** Short sha of HEAD — 'unknown' when git is unavailable (source tarball, fresh repo). */
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Build identity, inlined as the `__TLDW_BUILD__` constant in every bundle
 * (declared in src/vite-env.d.ts, consumed via `buildReport`'s `build` input).
 */
const buildInfo = {
  version: pkg.version,
  sha: gitSha(),
  date: new Date().toISOString(),
};

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  define: {
    __TLDW_BUILD__: JSON.stringify(buildInfo),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      // Extra HTML entry that isn't referenced by the manifest (created at
      // runtime via chrome.offscreen.createDocument).
      input: {
        offscreen: fileURLToPath(new URL('./src/offscreen/offscreen.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
