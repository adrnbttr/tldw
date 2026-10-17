// Pre-release gate. Runs the full pipeline (lint + tests + build), then checks
// that the version is consistent everywhere it ships:
//   package.json == dist/manifest.json == a dated CHANGELOG.md entry
//     (« ## [x.y.z] - YYYY-MM-DD »).
// Each failed check prints one explicit message and exits non-zero.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

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

run('Lint', 'npm run lint');
run('Tests', 'npm test');
run('Build', 'npm run build');

console.log('› Vérification des versions…');

// 1) package.json == dist/manifest.json (the manifest that actually ships).
const manifestPath = join(root, 'dist', 'manifest.json');
let manifestVersion;
try {
  manifestVersion = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
} catch {
  console.error(`✗ ${manifestPath} absent ou illisible — le build l’a-t-il bien produit ?`);
  process.exit(1);
}
if (manifestVersion !== pkgVersion) {
  console.error(
    `✗ Écart : package.json dit ${pkgVersion}, dist/manifest.json dit ${manifestVersion}.`,
  );
  process.exit(1);
}
console.log(`✓ package.json == dist/manifest.json (${pkgVersion})`);

// 2) CHANGELOG.md has a dated entry for this version.
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const releases = [...changelog.matchAll(/^## \[(\S+)\] - (\d{4}-\d{2}-\d{2})\s*$/gm)];
const current = releases.find(([, v]) => v === pkgVersion);
if (!current) {
  console.error(`✗ CHANGELOG.md n’a pas d’entrée datée pour ${pkgVersion}`);
  console.error(`  attendu : « ## [${pkgVersion}] - YYYY-MM-DD »`);
  const [latest] = releases;
  if (latest) {
    console.error(`  dernière entrée datée : [${latest[1]}] - ${latest[2]}`);
  } else {
    console.error(
      '  aucune entrée datée — les changements sont peut-être encore sous [Unreleased]',
    );
  }
  process.exit(1);
}
console.log(`✓ CHANGELOG.md : [${pkgVersion}] - ${current[2]}`);

console.log('');
console.log(`✓ Release check OK — tout est aligné sur ${pkgVersion}.`);
console.log('  Prochaine étape : « npm run package » pour le zip store-ready.');
