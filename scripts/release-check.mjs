// Pre-release gate. Static checks first, so a forgotten bump fails in seconds
// instead of after the whole pipeline:
//   - git tree clean (unless --allow-dirty) and tag vX.Y.Z not already taken;
//   - package.json == package-lock.json (top-level and packages[""]);
//   - CHANGELOG: empty [Unreleased], a dated, valid, non-future [x.y.z] entry;
// then the pipeline (lint + tests + build), then checks on what was built:
//   - detection e2e (headless Chromium, `node e2e/run.mjs`) against that same dist/,
//     then the audio-pipeline e2e (`node e2e/pipeline.mjs`, stubbed APIs) on it too;
//   - every content-script loader chunk is web-accessible for its own matches
//     (the guarantee that matters: dist/manifest.json.version == package.json is
//     tautological, the manifest is generated from it).
// Each failed check prints explicit messages and exits non-zero.
// Flags: --allow-dirty — local dry runs only;
//        --skip-e2e — machines without Chromium (prints a loud warning).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { planE2e } from './lib/e2e-gate.mjs';
import {
  checkLockVersion,
  checkReleaseDate,
  checkUnreleasedEmpty,
  checkWebAccessible,
} from './lib/release-checks.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowDirty = process.argv.includes('--allow-dirty');
const skipE2e = process.argv.includes('--skip-e2e');
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

function git(args) {
  return execSync(`git ${args}`, { cwd: root }).toString().trim();
}

function fail(errors) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}

// Runs one pipeline step; exits with a clear message if it fails.
function run(step, command) {
  console.log(`› ${step}…`);
  try {
    execSync(command, { cwd: root, stdio: 'inherit' });
  } catch {
    console.error(`✗ ${step} a échoué — corrige puis relance « npm run release:check ».`);
    process.exit(1);
  }
}

// Git state first: the build embeds the sha (+ "-dirty"), so it must be clean.
console.log('› Vérification de git…');
const gitErrors = [];
if (git('status --porcelain') !== '') {
  const msg =
    'working tree sale — commit (bump + CHANGELOG) avant le release:check, ou --allow-dirty pour un essai local.';
  if (allowDirty) console.warn(`⚠ ${msg}`);
  else gitErrors.push(msg);
}
if (git(`tag -l v${pkgVersion}`) !== '') {
  gitErrors.push(`le tag v${pkgVersion} existe déjà localement — bump la version ?`);
}
// Remote tag: only when an `origin` exists; offline / unreachable → skipped.
if (git('remote').split('\n').includes('origin')) {
  try {
    const remote = execSync(`git ls-remote --tags origin refs/tags/v${pkgVersion}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    }).trim();
    if (remote !== '') {
      gitErrors.push(`le tag v${pkgVersion} existe déjà sur origin — bump la version ?`);
    }
  } catch {
    console.warn('⚠ origin injoignable : tag distant non vérifié.');
  }
}
if (gitErrors.length) fail(gitErrors);

// Version and CHANGELOG coherence — static, before any build.
console.log('› Vérification des versions et du CHANGELOG…');
{
  const errors = [];
  errors.push(
    ...checkLockVersion(
      JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')),
      pkgVersion,
    ),
  );
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  errors.push(...checkUnreleasedEmpty(changelog));
  const releases = [...changelog.matchAll(/^## \[(\S+)\] - (\S+)\s*$/gm)];
  const current = releases.find(([, v]) => v === pkgVersion);
  if (!current) {
    errors.push(`CHANGELOG.md n’a pas d’entrée datée pour ${pkgVersion}`);
    errors.push(`  attendu : « ## [${pkgVersion}] - YYYY-MM-DD »`);
  } else {
    errors.push(...checkReleaseDate(current[2]));
  }
  if (errors.length) fail(errors);
}

run('Lint', 'npm run lint');
run('Tests', 'npm test');
run('Build', 'npm run build');

// Detection + audio-pipeline e2e on the dist/ just built (no rebuild: the zip ships this very dist).
{
  const chromiumInstalled = skipE2e
    ? true
    : (await import('../e2e/lib/harness.mjs')).chromiumInstalled();
  const plan = planE2e({ skip: skipE2e, chromiumInstalled });
  if (plan.action === 'fail') fail([plan.message]);
  if (plan.action === 'skip') {
    console.warn('\n⚠⚠⚠ ' + plan.message + ' ⚠⚠⚠\n');
  } else {
    run('E2E de détection', 'node e2e/run.mjs');
    run('E2E du pipeline audio', 'node e2e/pipeline.mjs');
  }
}

console.log('› Vérification du manifest construit…');

const manifestPath = join(root, 'dist', 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch {
  fail([`${manifestPath} absent ou illisible — le build l’a-t-il bien produit ?`]);
}
// Sanity only: crxjs derives this from package.json, so it proves nothing real.
if (manifest.version !== pkgVersion) {
  fail([`package.json dit ${pkgVersion}, dist/manifest.json dit ${manifest.version}.`]);
}

const errors = [];

console.log('› Vérification des web_accessible_resources des content scripts…');
errors.push(...checkWebAccessible(manifest, (p) => readFileSync(join(root, 'dist', p), 'utf8')));

if (errors.length) fail(errors);

console.log(`✓ Release check OK — tout est aligné sur ${pkgVersion}.`);
console.log('  Prochaine étape : « npm run package » (zippe ce même dist/).');
