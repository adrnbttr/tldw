/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import type { Plugin } from 'vite';
import pkg from './package.json';
import manifest from './manifest.config';

/**
 * Short sha of HEAD, suffixed `-dirty` when the working tree has uncommitted
 * changes — 'unknown' when git is unavailable (source tarball, fresh repo).
 */
function gitSha(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    const dirty = execSync('git status --porcelain').toString().trim() !== '';
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

/**
 * crxjs lists every chunk's `.map` in web_accessible_resources. Maps are not
 * shipped in the store zip, so drop them from the emitted manifest.
 */
function stripMapsFromWar(): Plugin {
  let outDir = 'dist';
  return {
    name: 'tldw:strip-maps-from-war',
    enforce: 'post',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    writeBundle() {
      const path = join(outDir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8'));
      for (const entry of manifest.web_accessible_resources ?? []) {
        entry.resources = entry.resources.filter((r: string) => !r.endsWith('.map'));
      }
      writeFileSync(path, JSON.stringify(manifest, null, 2));
    },
  };
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
  plugins: [preact(), crx({ manifest }), stripMapsFromWar()],
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
    // 'hidden': maps are generated for debugging but not referenced from the .js.
    sourcemap: 'hidden',
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
    // e2e/ is deliberately absent: it runs in real Chromium via `npm run test:e2e`.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
