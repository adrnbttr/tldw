// Builds the extension and prints the essentials for loading it by hand in
// Chrome: the absolute dist/ path, the build identity (version + short sha),
// and the reload reminder. Companion to `npm run package` (store zip) and
// `npm run share` (hand-install zip) — this one is for the dev loop.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const distDir = join(root, 'dist');

// Short sha of HEAD — 'unknown' when git is unavailable (mirrors vite.config.ts).
function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

console.log('› Building…');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

console.log('');
console.log('✓ Extension prête à charger.');
console.log(`  dist/    ${distDir}`);
console.log(`  version  ${version}`);
console.log(`  sha      ${gitSha()}`);
console.log('');
console.log('↻ Reload sur chrome://extensions (bouton ↻ sur la carte tldw).');
console.log('  Première fois : Mode développeur → « Charger l’extension non empaquetée »,');
console.log(`  puis sélectionne le dossier ${distDir}.`);
