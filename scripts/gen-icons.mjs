// Rasterizes the vector logo (.github/assets/icon.svg) into the PNG sizes the
// manifest needs. Run after changing the logo: `npm run icons`.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, '.github', 'assets', 'icon.svg'), 'utf8');
const out = join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });

for (const size of [16, 48, 128]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  const png = resvg.render().asPng();
  writeFileSync(join(out, `icon-${size}.png`), png);
  console.log(`icon-${size}.png`);
}
