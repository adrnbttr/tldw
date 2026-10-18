# Releasing & debugging builds

How to build and load the extension by hand, capture a diagnostic report when
something breaks, and cut a release.

## 1 · Build & load a test build

```bash
npm install && npm run build:test
```

The script prints the absolute path to `dist/` (plus the build version and short
sha). Load it in Chrome: `chrome://extensions` → **Developer mode** → **Load
unpacked** → select `dist/`.

After every rebuild, click the ↻ **reload** icon on the tldw card — Chrome never
picks up changes on its own, and the popup/service worker must be restarted.

## 2 · When something breaks: the diagnostic report

Before digging into DevTools consoles, grab the built-in diagnostic report:

- **Settings → Diagnostic → "Copy the report"** puts it in your clipboard (the same
  **Copy report** link is offered directly on an error row).
- **Download the report** saves it as `tldw-diagnostic-<date>.txt`; **Clear logs** starts a
  fresh log.

The report is generated locally: API keys appear only as "present: yes/no", secrets and signed
URLs are masked, and nothing is sent anywhere. Contents, redaction rules and error codes:
[TROUBLESHOOTING.md](./TROUBLESHOOTING.md); privacy: [PRIVACY.md](./PRIVACY.md).

## 3 · Cutting a release

Prerequisites: Node 20 (`.nvmrc`), git (the gate also checks `origin` for the tag), and **Python 3** (`python3`
or `python` on PATH) — `npm run package` builds the zip with Python's `zipfile` CLI, so no
`zip` binary is needed. The `gh` CLI is needed for the last step.

1. **Bump the version** in `package.json`, then run `npm install` to sync
   `package-lock.json`.
2. **CHANGELOG.md** — move the `## [Unreleased]` notes under
   `## [0.3.0] - YYYY-MM-DD` (example), dated with the release day, and leave
   `[Unreleased]` empty.
3. **Commit** the bump + CHANGELOG (`git commit -am "chore(release): v0.3.0"`)
   _before_ running any check: the build embeds the commit sha, and the gate refuses
   a dirty tree, so the shipped build matches the released commit.
4. **Gate** — `npm run release:check` runs, in this order: clean git tree; tag `vX.Y.Z`
   not already taken locally nor on `origin` (an unreachable `origin` only warns);
   `package-lock.json` in sync; empty `[Unreleased]`; a dated, valid, non-future
   `## [X.Y.Z] - YYYY-MM-DD` entry — these static checks come first, so a forgotten
   bump fails in seconds; then `npm run lint`, `npm test`, `npm run build`; the
   detection e2e suite (`node e2e/run.mjs`, headless Chromium) then the audio-pipeline e2e
   (`node e2e/pipeline.mjs`, stubbed APIs) against that same `dist/`, without rebuilding it; `dist/manifest.json` version equals `package.json`;
   and every content-script loader chunk listed in `web_accessible_resources` for its
   own matches. Each failure prints an
   explicit message and the command exits non-zero.
5. **Package** — `npm run package`: runs the same gate (so the tree must still be clean),
   then zips that very `dist/` — contents at the archive root, source maps excluded, no
   second build — into `tldw-v0.3.0.zip` at the repo root. Users unzip it into a folder and
   **Load unpacked** (see [INSTALL.md](./INSTALL.md)).
6. **Tag & publish**:
   ```bash
   git tag v0.3.0
   git push && git push origin v0.3.0
   gh release create v0.3.0 tldw-v0.3.0.zip --notes-file <notes-file>
   ```

`--allow-dirty` (`npm run release:check -- --allow-dirty`, `npm run package -- --allow-dirty`)
only downgrades the clean-tree check to a warning, for **local dry runs only** — never for a
real release: the embedded commit sha would not match the released commit.

The e2e step needs Playwright's Chromium (`npm run e2e:install`, once). Without it the gate
fails with that hint. `--skip-e2e` (`npm run release:check -- --skip-e2e`, also accepted by
`npm run package`) skips both suites with a loud warning: use it only on a machine without
Chromium, and run `npm run test:e2e` and `npm run test:e2e:pipeline` elsewhere before publishing.

For hands-on validation in a real browser, see [TESTING.md](./TESTING.md).
