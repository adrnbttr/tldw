// Runs the release gate (lint + tests + build + checks) and zips the exact dist/
// it validated — no second build. Source maps are excluded.
// `--allow-dirty` (local dry runs only) and `--skip-e2e` (no Chromium) are passed through to the gate.
import { execSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createZip } from './lib/zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zipName = `tldw-v${version}.zip`;

const passthrough = ['--allow-dirty', '--skip-e2e']
  .filter((flag) => process.argv.includes(flag))
  .map((flag) => ` ${flag}`)
  .join('');
console.log('› Release check (builds dist/)…');
try {
  execSync(`node scripts/release-check.mjs${passthrough}`, { cwd: root, stdio: 'inherit' });
} catch {
  console.error('✗ release:check a échoué — rien n’a été empaqueté.');
  process.exit(1);
}

rmSync(join(root, zipName), { force: true });

console.log(`› Packaging dist/ → ${zipName}`);
createZip(join(root, 'dist'), join(root, zipName), { exclude: ['*.map'] });

console.log(`✓ ${zipName} ready for the Chrome Web Store.`);
