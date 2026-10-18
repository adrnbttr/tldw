import { describe, expect, it } from 'vitest';
import {
  checkLockVersion,
  checkReleaseDate,
  checkUnreleasedEmpty,
  checkWebAccessible,
  loaderAssets,
} from './release-checks.mjs';

const loader = (f) => `const {x}=await import(chrome.runtime.getURL("${f}"));`;

describe('checkWebAccessible', () => {
  const files = {
    'assets/a-loader.js': loader('assets/a.js'),
    'assets/b-loader.js': loader('assets/b.js'),
    'assets/a.js': 'import{l}from"./lib.js";',
    'assets/b.js': '',
    'assets/lib.js': '',
  };
  const read = (p) => {
    if (!(p in files)) throw new Error('missing');
    return files[p];
  };

  it('extracts getURL paths', () => {
    expect(loaderAssets(files['assets/a-loader.js'])).toEqual(['assets/a.js']);
  });

  it('passes when each loader is covered', () => {
    const manifest = {
      content_scripts: [
        { matches: ['<all_urls>'], js: ['assets/a-loader.js'] },
        { matches: ['https://d.com/*'], js: ['assets/b-loader.js'] },
      ],
      web_accessible_resources: [
        { matches: ['<all_urls>'], resources: ['assets/a.js', 'assets/lib.js'] },
        { matches: ['https://d.com/*'], resources: ['assets/b.js'] },
      ],
    };
    expect(checkWebAccessible(manifest, read)).toEqual([]);
  });

  it('fails when an <all_urls> loader is only exposed to a narrower match (the crxjs overwrite)', () => {
    const manifest = {
      content_scripts: [{ matches: ['<all_urls>'], js: ['assets/a-loader.js'] }],
      web_accessible_resources: [
        { matches: ['https://d.com/*'], resources: ['assets/a.js', 'assets/lib.js'] },
      ],
    };
    expect(checkWebAccessible(manifest, read).length).toBeGreaterThan(0);
  });

  it('fails when a static dependency is not exposed', () => {
    const manifest = {
      content_scripts: [{ matches: ['<all_urls>'], js: ['assets/a-loader.js'] }],
      web_accessible_resources: [{ matches: ['<all_urls>'], resources: ['assets/a.js'] }],
    };
    expect(checkWebAccessible(manifest, read)).toEqual([expect.stringContaining('assets/lib.js')]);
  });
});

describe('checkLockVersion', () => {
  it('accepts matching versions', () => {
    expect(
      checkLockVersion({ version: '1.0.0', packages: { '': { version: '1.0.0' } } }, '1.0.0'),
    ).toEqual([]);
  });
  it('flags both mismatches', () => {
    expect(
      checkLockVersion({ version: '0.9.0', packages: { '': { version: '0.9.0' } } }, '1.0.0'),
    ).toHaveLength(2);
  });
});

describe('checkUnreleasedEmpty', () => {
  it('accepts an empty section', () => {
    expect(checkUnreleasedEmpty('## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n- x\n')).toEqual([]);
  });
  it('rejects content', () => {
    expect(
      checkUnreleasedEmpty('## [Unreleased]\n\n### Added\n- x\n\n## [1.0.0] - 2026-01-01\n'),
    ).toHaveLength(1);
  });
  it('handles an Unreleased section followed only by link refs', () => {
    expect(checkUnreleasedEmpty('## [Unreleased]\n- y\n\n[Unreleased]: http://x\n')).toHaveLength(
      1,
    );
  });
});

describe('checkReleaseDate', () => {
  const today = new Date('2026-10-18T12:00:00Z');
  it('accepts today and the past', () => {
    expect(checkReleaseDate('2026-10-18', today)).toEqual([]);
    expect(checkReleaseDate('2026-01-01', today)).toEqual([]);
  });
  it('rejects the future and impossible dates', () => {
    expect(checkReleaseDate('2026-10-19', today)).toHaveLength(1);
    expect(checkReleaseDate('2026-02-30', today)).toHaveLength(1);
    expect(checkReleaseDate('2026-13-01', today)).toHaveLength(1);
  });
  it('uses the local date: Paris just after midnight is not "future"', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'Europe/Paris';
    try {
      // 2026-10-17T22:30Z = 2026-10-18 00:30 in Paris
      expect(checkReleaseDate('2026-10-18', new Date('2026-10-17T22:30:00Z'))).toEqual([]);
      expect(checkReleaseDate('2026-10-19', new Date('2026-10-17T22:30:00Z'))).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });
});
