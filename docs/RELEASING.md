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

- **Settings → Diagnostic → "Copy report"** puts a full report in your clipboard
  (the same **copy report** link is offered directly on an error row).
- **Download** saves it as `tldw-diagnostic-<date>.txt`; **Clear logs** starts a
  fresh log.

The report is generated locally on your machine: it contains no API keys and
nothing is sent anywhere. What you do with it is entirely up to you — see
[PRIVACY.md](./PRIVACY.md).

## 3 · Cutting a release

1. **Bump the version** in `package.json`, then run `npm install` to sync
   `package-lock.json`.
2. **CHANGELOG.md** — turn the `## [Unreleased]` section into
   `## [0.3.0] - YYYY-MM-DD` (example), dated with the release day.
3. **Gate** — `npm run release:check`: lint + unit tests + build, then checks
   that `package.json` == `dist/manifest.json` == a dated CHANGELOG entry.
4. **Package** — `npm run package`: builds the extension and zips `dist/` into
   `tldw-v0.3.0.zip` (source maps excluded). No `zip` binary required — it
   shells out to `python3`'s `zipfile` CLI.
5. **Publish**:
   ```bash
   git commit -am "Release v0.3.0"
   git tag v0.3.0
   git push --tags
   gh release create v0.3.0 tldw-v0.3.0.zip --notes-file <notes-file>
   ```

For hands-on validation in a real browser, see [TESTING.md](./TESTING.md).
