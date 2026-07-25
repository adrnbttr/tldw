# Chrome Web Store — submission checklist

> **Status: not currently planned.** tldw is used personally via Developer mode
> (see the README). This folder is kept ready in case publishing happens later.

## 1. Package

```bash
npm run package        # builds + zips → tldw-v<version>.zip
```

Upload `tldw-v<version>.zip` in the dashboard. Bump `version` in both
`package.json` and the manifest before each new upload (they share the value via
`manifest.config.ts`).

## 2. Required assets

Chrome requires PNG/JPEG. Source SVGs live in `.github/assets/` — export them to
the sizes below (e.g. with an SVG-to-PNG tool or a browser screenshot).

| Asset | Size | Required | Source |
|---|---|---|---|
| Store icon | 128×128 | ✅ | `public/icons/icon-128.png` (rendered from `.github/assets/icon.svg`) |
| Screenshot(s) | 1280×800 or 640×400 | ✅ (1–5) | Real captures of the popup — list, processing, result, settings |
| Small promo tile | 440×280 | ✅ | Derive from `.github/assets/logo.svg` or `banner.svg` |
| Marquee promo tile | 1400×560 | optional | Derive from `.github/assets/banner.svg` |

> The app icon is real artwork now (`npm run icons` regenerates the PNGs from the
> SVG). Screenshots still need to be captured from the running extension.

## 3. Listing copy

All text fields (name, summary, description, single-purpose, permission
justifications, data disclosures) are in [`listing.md`](./listing.md).

## 4. Privacy

- Privacy policy is hosted at <https://www.adrienbouttier.com/tldw/> (GitHub Pages,
  served from `docs/`).
- In the dashboard, complete the **Privacy practices** tab: declare *no data
  collection by the developer*, justify each permission (table in `listing.md`),
  and paste the privacy policy URL.

## 5. Review notes (paste into "Notes for reviewers")

```
tldw is a personal-productivity tool. It runs entirely client-side with the user's
own API keys (OpenRouter for summaries; an optional transcription provider for the
audio fallback). No backend, no analytics. The broad host permission is required
because embedded video players and their media can be served from any site the user
visits; the extension only reads the page on user action and fetches captions/media.
It never bypasses DRM — encrypted media returns a typed MEDIA_PROTECTED error.
```

## 6. Post-submission

- Chrome review typically takes a few days; broad host permissions may extend it.
- Track versions in [`../CHANGELOG.md`](../CHANGELOG.md).
