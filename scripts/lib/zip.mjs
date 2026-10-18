// Zip helper shared by scripts/package.mjs and scripts/share.mjs.
//
// The `zip` binary is not available on every machine (absent here), so this
// shells out to python3's zipfile CLI instead of adding a dependency. That CLI
// deflates files (same as `zip -r`) but has no exclusion flag and flattens
// explicit file paths to their basename, so any run with `exclude` first stages
// a filtered copy of the source and archives the stage's contents (`.`).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let pythonBin;
/** First of `python3` / `python` that is a working Python 3; throws a clear error otherwise. */
function findPython() {
  if (pythonBin) return pythonBin;
  for (const bin of ['python3', 'python']) {
    try {
      const out = execFileSync(bin, ['-c', 'import sys; print(sys.version_info[0])'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
      if (out === '3') return (pythonBin = bin);
    } catch {
      // not installed / not runnable — try the next candidate
    }
  }
  throw new Error(
    'Python 3 is required to build the zip: install it (python3 or python on PATH) or use a machine that has it.',
  );
}

/** Translate a `zip -x`-style glob ('*.map') into a RegExp ('.*\\.map'). */
function globToRegExp(glob) {
  const source = glob.replace(/[.+^${}()|[\]\\*?]/g, (ch) =>
    ch === '*' ? '.*' : ch === '?' ? '.' : `\\${ch}`,
  );
  return new RegExp(`^${source}$`);
}

/**
 * Collect every file under `dir`, as `'/'`-joined paths relative to `dir`.
 * Directories are collected into `dirs` (so empty ones survive staging);
 * symlinks and other non-regular entries are skipped (dist/ holds none).
 */
function collect(dir, prefix, files, dirs) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      dirs.push(rel);
      collect(join(dir, entry.name), rel, files, dirs);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
}

/**
 * Archive the *contents* of `sourceDir` into `zipPath` — entries keep their
 * paths relative to `sourceDir`, so its manifest.json lands at the archive
 * root. Files whose relative path matches an `exclude` glob are left out
 * (`*` matches across directories, like `zip -x '*.map'`).
 */
export function createZip(sourceDir, zipPath, { exclude = [] } = {}) {
  const src = resolve(sourceDir);
  const out = resolve(zipPath);
  const patterns = exclude.map(globToRegExp);
  const python = findPython();

  if (patterns.length === 0) {
    execFileSync(python, ['-m', 'zipfile', '-c', out, '.'], {
      cwd: src,
      stdio: 'inherit',
    });
    return;
  }

  const files = [];
  const dirs = [];
  collect(src, '', files, dirs);
  const stage = mkdtempSync(join(tmpdir(), 'tldw-zip-'));
  try {
    for (const dir of dirs) mkdirSync(join(stage, dir), { recursive: true });
    for (const file of files) {
      if (patterns.some((re) => re.test(file))) continue;
      copyFileSync(join(src, file), join(stage, file));
    }
    execFileSync(python, ['-m', 'zipfile', '-c', out, '.'], {
      cwd: stage,
      stdio: 'inherit',
    });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
