// Copies the self-contained ffmpeg.wasm core + worker into public/ffmpeg so they
// ship with the extension and load from a same-origin chrome-extension:// URL.
// Single-threaded core is used on purpose: no SharedArrayBuffer, no COOP/COEP.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'ffmpeg');
mkdirSync(out, { recursive: true });

// ESM core: the class worker (bundled by Vite) loads it via dynamic import(),
// which works from a same-origin chrome-extension:// URL under the extension CSP.
const files = [
  ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'ffmpeg-core.js'],
  ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'ffmpeg-core.wasm'],
];

for (const [from, to] of files) {
  copyFileSync(join(root, from), join(out, to));
  console.log(`ffmpeg → public/ffmpeg/${to}`);
}
