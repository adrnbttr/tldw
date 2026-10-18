// Detection e2e suite for tldw: loads the BUILT extension (dist/) in headless
// Chromium and checks which videos each fixture page yields.
//
//   node e2e/run.mjs [--build] [--only=id1,id2] [--json] [--workers=N] [--dist=DIR]
//
// --build    runs `npm run build` first (otherwise dist/ is used as is: the
//            release gate validates the very dist it zips).
// --workers  parallel Chromium instances (default 3).
// Everything under test goes through the extension's own messages (LIST_VIDEOS,
// RESCAN) — no detection/merge logic is duplicated here.
// Exit code: 1 on any ✗ / ERR cell or uncaught page exception, 2 if Chromium is
// missing, 0 otherwise.
import { execSync } from 'node:child_process';
import { FIXTURES, A } from './lib/fixtures.mjs';
import {
  REPO,
  startServers,
  launch,
  popupProbe,
  stageExtension,
  chromiumInstalled,
} from './lib/harness.mjs';

const argv = process.argv.slice(2);
const arg = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

if (!chromiumInstalled()) {
  console.error(
    '✗ Chromium (Playwright) introuvable — lance « npm run e2e:install » (ou définis CHROME=/chemin/vers/chrome).',
  );
  process.exit(2);
}
if (argv.includes('--build')) execSync('npm run build', { cwd: REPO, stdio: 'inherit' });

const only = arg('only')?.split(',');
const list = only ? FIXTURES.filter((f) => only.includes(f.id)) : FIXTURES;
if (only && list.length === 0) {
  console.error(`✗ aucune fixture ne correspond à --only=${only.join(',')}`);
  process.exit(1);
}
const workers = Math.max(1, Math.min(Number(arg('workers')) || 3, list.length));
const t0 = Date.now();

function tokens(videos) {
  return videos.map((v) =>
    v.provider === 'native'
      ? v.mediaSrc
        ? 'native'
        : 'native:blob'
      : `${v.provider}:${v.externalId}`,
  );
}
function verdict(fx, videos) {
  if (fx.expect == null || fx.reportOnly) return '~';
  const got = tokens(videos);
  const pool = [...got];
  for (const e of fx.expect) {
    let i = pool.indexOf(e);
    if (i < 0 && e === 'native') i = pool.indexOf('native:blob');
    if (e === 'native:any') i = pool.findIndex((t) => t.startsWith('native'));
    if (i < 0) return '✗';
    pool.splice(i, 1);
  }
  if (pool.length) return '✗';
  if (fx.expectTitle && !videos.some((v) => (v.title || '').startsWith(fx.expectTitle))) return '✗';
  if (fx.expectMediaSrc && !videos.some((v) => (v.mediaSrc || '').endsWith(fx.expectMediaSrc)))
    return '✗';
  return '✓';
}
const fmt = (v) =>
  `${v.provider}:${v.externalId || '-'} f${v.frameId} ${v.mediaSrc ? 'src=' + v.mediaSrc.replace(/^https?:\/\/[^/]+\//, '') : v.provider === 'native' ? 'src=null' : ''} dur=${v.duration == null ? 'null' : Math.round(v.duration)}${v.title ? ` "${v.title.slice(0, 24)}"` : ''}`;

async function runOne(fx, ctx, probe) {
  const page = await ctx.newPage();
  const errors = [];
  const exceptions = [];
  page.on('pageerror', (e) => exceptions.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  let row;
  try {
    await page.goto(fx.url ?? `${A}/f/${fx.id}.html`, { waitUntil: 'load' });
    if (fx.flow) await fx.flow(page);
    await page.waitForTimeout(fx.wait ?? 3000);
    const vPassive = await probe.list(page);
    const vRescan = await probe.rescan(page);
    await page.waitForTimeout(300);
    const vPopup = await probe.list(page);
    row = {
      id: fx.id,
      expect: fx.expect,
      passive: verdict(fx, vPassive),
      popup: verdict(fx, vPopup),
      rescan: verdict(fx, vRescan),
      detectedPopup: vPopup.map(fmt),
      detected: vPassive.map(fmt),
      detectedAfterRescan: vRescan.map(fmt),
      note: fx.note ?? '',
    };
  } catch (e) {
    row = {
      id: fx.id,
      expect: fx.expect,
      passive: 'ERR',
      popup: 'ERR',
      rescan: 'ERR',
      detectedPopup: [],
      detected: [String(e.message).slice(0, 120)],
      detectedAfterRescan: [],
      note: '',
    };
  }
  row.errors = errors.filter((e) => !/404|Failed to load resource/.test(e));
  row.exceptions = exceptions;
  await page.close();
  return row;
}

const stop = startServers();
const staged = stageExtension(arg('dist'));
const rows = new Array(list.length);
let next = 0;
async function worker() {
  const { ctx, sw, close } = await launch({ ext: staged.dir });
  try {
    const probe = await popupProbe(ctx, sw);
    for (;;) {
      const i = next++;
      if (i >= list.length) break;
      rows[i] = await runOne(list[i], ctx, probe);
    }
  } finally {
    await close();
  }
}
try {
  await Promise.all(Array.from({ length: workers }, worker));
} finally {
  stop();
  staged.cleanup();
}

if (argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else {
  console.log(
    'fixture'.padEnd(42),
    'idle',
    'popup',
    'rescan',
    ' expected  ->  detected (merged list, provider:externalId frameId mediaSrc duration title)',
  );
  for (const r of rows) {
    console.log(
      r.id.padEnd(42),
      ` ${r.passive}  `,
      ` ${r.popup}  `,
      ` ${r.rescan}   `,
      JSON.stringify(r.expect),
      '->',
      r.detected.join(' | ') || '(nothing)',
    );
    if (r.detectedPopup.join() !== r.detected.join())
      console.log(
        ''.padEnd(52),
        'popup LIST_VIDEOS ->',
        r.detectedPopup.join(' | ') || '(nothing)',
      );
    if (r.detectedAfterRescan.join() !== r.detected.join())
      console.log(
        ''.padEnd(52),
        'after rescan ->',
        r.detectedAfterRescan.join(' | ') || '(nothing)',
      );
    if (r.errors.length) console.log(''.padEnd(52), 'ERRORS:', r.errors.join(' ; '));
  }
  const graded = rows.filter((r) => r.passive !== '~');
  console.log(
    `\nidle(LIST_VIDEOS): ${graded.filter((r) => r.passive === '✓').length}/${graded.length} ✓   reopened popup: ${graded.filter((r) => r.popup === '✓').length}/${graded.length} ✓   after rescan: ${graded.filter((r) => r.rescan === '✓').length}/${graded.length} ✓   (~ = report-only)`,
  );
}

const graded = rows.filter((r) => r.passive !== '~');
const bad = rows.filter((r) =>
  [r.passive, r.popup, r.rescan].some((v) => v === '✗' || v === 'ERR'),
);
const thrown = rows.filter((r) => r.exceptions.length);
for (const r of thrown) console.error(`✗ exception dans ${r.id}: ${r.exceptions.join(' ; ')}`);
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s, ${workers} worker(s)`);
if (bad.length || thrown.length) {
  console.error(
    `✗ e2e: ${bad.length} fixture(s) en échec${bad.length ? ` (${bad.map((r) => r.id).join(', ')})` : ''}, ${thrown.length} avec exception.`,
  );
  process.exit(1);
}
console.log(`✓ e2e: ${graded.length} fixtures vérifiées.`);
