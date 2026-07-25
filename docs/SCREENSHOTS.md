# Screenshot guide

How to capture the screenshots used in the README and (later) the Chrome Web Store
listing, so they look consistent and clean.

Save PNGs to `.github/assets/screenshots/` with the filenames in the table below,
then reference them from the [Preview](../README.md#preview) section.

## What to capture

| File | Screen | How to reach it |
|---|---|---|
| `list.png` | Video list | Open a page with 1–2 videos, open the popup |
| `processing.png` | Processing view | Click **Summarize**, capture mid-run (the stepper) |
| `result.png` | Rendered summary | Let it finish — show the summary + action buttons |
| `settings.png` | Settings | Open ⚙ Settings — **blur or fake the API keys** |
| `history.png` | History (optional) | Click 🕘 after generating a few summaries |
| `batch.png` | Batch (optional) | Select 2+ videos, run, capture the results list |

## Capturing the popup cleanly

The popup closes as soon as it loses focus, which makes it hard to screenshot. Two
reliable ways:

1. **Keep it open with DevTools.** Right-click the popup → **Inspect**. The popup
   stays open while its DevTools is focused. Then screenshot just the popup window
   (macOS: <kbd>⌘⇧4</kbd> then <kbd>Space</kbd> and click the window; Windows:
   <kbd>Win+Shift+S</kbd>).

2. **Open it as a tab.** Visit
   `chrome-extension://<your-extension-id>/src/popup/index.html` in a normal tab
   (find the id on `chrome://extensions`). It renders full-page and is easy to
   capture — though detection is empty there, so use method 1 for the list/result
   shots.

## Consistency checklist

- Use the **same theme** (light or dark) across all shots — the popup follows your
  OS setting; pick one and stick to it.
- Use a **real, non-sensitive** video (a public YouTube embed is ideal).
- **Never show real API keys.** In Settings, type a placeholder like
  `sk-or-xxxxxxxx` before capturing, or blur it afterwards.
- Keep the popup at its natural width (380 px) — don't stretch it.
- Trim OS chrome (window shadows are fine; desktop clutter is not).

## Optimizing the files

Keep each PNG lean so the README stays fast to load:

```bash
# optional, if you have pngquant / oxipng installed
pngquant --quality=70-90 --ext .png --force .github/assets/screenshots/*.png
```

Aim for < 200 KB per image. A width of ~760 px (the popup at 2× DPR) is plenty.

## Wiring them into the README

The README currently uses an SVG mock in the Preview section. Once you have real
shots, swap it for a small gallery, e.g.:

```html
<p align="center">
  <img src="./.github/assets/screenshots/list.png"   width="30%" alt="Detected videos" />
  <img src="./.github/assets/screenshots/result.png" width="30%" alt="Rendered summary" />
  <img src="./.github/assets/screenshots/settings.png" width="30%" alt="Settings" />
</p>
```

Keep the SVG mock (`.github/assets/popup-mockup.svg`) as a fallback — it renders on
any renderer that blocks external images.
