// Pure release-gate checks (no I/O besides the injected `readAsset`), so they
// can be unit-tested. Each returns a list of error strings (empty = OK).
import { posix } from 'node:path';

/** Extension-relative asset paths a content-script loader imports via getURL(). */
export function loaderAssets(source) {
  return [...source.matchAll(/getURL\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1]);
}

/** Relative static imports of a chunk (`from "./x.js"`, `import "./x.js"`), resolved. */
export function staticImports(source, chunkPath) {
  const found = new Set();
  for (const m of source.matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    found.add(posix.join(posix.dirname(chunkPath), m[1]));
  }
  return [...found];
}

/** True when a web_accessible_resources entry exposes to every one of `matches`. */
function covers(entryMatches, matches) {
  if (entryMatches.includes('<all_urls>')) return true;
  return matches.every((m) => m !== '<all_urls>' && entryMatches.includes(m));
}

/**
 * Every content-script loader's imported chunk (and its static dependencies)
 * must be web-accessible for all of that content script's matches, otherwise
 * Chrome denies the dynamic import().
 */
export function checkWebAccessible(manifest, readAsset) {
  const errors = [];
  const war = manifest.web_accessible_resources ?? [];
  const isCovered = (asset, matches) =>
    war.some((e) => (e.resources ?? []).includes(asset) && covers(e.matches ?? [], matches));

  for (const [i, cs] of (manifest.content_scripts ?? []).entries()) {
    const matches = cs.matches ?? [];
    for (const loader of cs.js ?? []) {
      let source;
      try {
        source = readAsset(loader);
      } catch {
        errors.push(`content_scripts[${i}] : loader ${loader} illisible`);
        continue;
      }
      const seen = new Set();
      const queue = loaderAssets(source);
      if (queue.length === 0) {
        errors.push(`content_scripts[${i}] : aucun import trouvé dans le loader ${loader}`);
      }
      while (queue.length) {
        const asset = queue.pop();
        if (seen.has(asset)) continue;
        seen.add(asset);
        if (!isCovered(asset, matches)) {
          errors.push(
            `content_scripts[${i}] : ${asset} (importé via ${loader}) n’est pas dans web_accessible_resources pour ${matches.join(', ')}`,
          );
        }
        try {
          queue.push(...staticImports(readAsset(asset), asset));
        } catch {
          errors.push(`content_scripts[${i}] : chunk ${asset} illisible`);
        }
      }
    }
  }
  return errors;
}

/** package-lock.json top-level and packages[""] versions must equal package.json's. */
export function checkLockVersion(lock, pkgVersion) {
  const errors = [];
  if (lock.version !== pkgVersion) {
    errors.push(`package-lock.json : version ${lock.version} != package.json ${pkgVersion}`);
  }
  const root = lock.packages?.[''];
  if (!root || root.version !== pkgVersion) {
    errors.push(
      `package-lock.json : packages[""].version ${root?.version} != package.json ${pkgVersion}`,
    );
  }
  return errors;
}

/** The `## [Unreleased]` section must hold no content (released notes live under a version). */
export function checkUnreleasedEmpty(changelog) {
  const m = changelog.match(
    /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|^\[[^\]]+\]: |(?![\s\S]))/m,
  );
  if (!m) return [];
  if (m[1].split('\n').some((l) => l.trim() !== '')) {
    return ['CHANGELOG.md : la section [Unreleased] n’est pas vide — range-la sous la version.'];
  }
  return [];
}

/** `YYYY-MM-DD` must be a real calendar date, not after `today` (a Date). */
export function checkReleaseDate(dateStr, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (
    !d ||
    d.getUTCFullYear() !== +m[1] ||
    d.getUTCMonth() !== +m[2] - 1 ||
    d.getUTCDate() !== +m[3]
  ) {
    return [`CHANGELOG.md : date de release invalide « ${dateStr} »`];
  }
  // Local calendar date (a release dated "today" in Paris just after midnight is
  // still the UTC day before): compare against the local date.
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  if (dateStr > todayStr) {
    return [`CHANGELOG.md : date de release ${dateStr} dans le futur (aujourd’hui : ${todayStr})`];
  }
  return [];
}
