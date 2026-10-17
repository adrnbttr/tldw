// Builds the extension and zips dist/ into a versioned, store-ready archive.
// Source maps are excluded to keep the upload lean.
import { execSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createZip } from './lib/zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zipName = `tldw-v${version}.zip`;

console.log('› Building…');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

rmSync(join(root, zipName), { force: true });

console.log(`› Packaging dist/ → ${zipName}`);
createZip(join(root, 'dist'), join(root, zipName), { exclude: ['*.map'] });

console.log(`✓ ${zipName} ready for the Chrome Web Store.`);
