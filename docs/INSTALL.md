# Installing tldw (no build, no account)

tldw ships as an **unpacked extension**: there is no Web Store listing and nothing
to compile on the user's side. Anyone can install it from a folder in about a
minute. This page is the procedure to share with a non-technical user — the same
steps are bundled as `INSTALL.txt` inside the archive produced by `npm run share`.

## What you need

- A **Chromium browser**: Chrome, Edge, Opera, Brave, or Arc.
- The **tldw archive** (`tldw-share-vX.Y.Z.zip`) — someone with the repo builds it
  once with `npm run share` and emails it over.
- A free **OpenRouter API key** — this is what powers the summaries. Each user
  brings their own; it never travels inside the archive.

## Steps

1. **Unzip** the archive. You get a folder named **`tldw-extension`** (and this
   `INSTALL.txt`). Keep the folder somewhere stable — if you move or delete it
   later, the browser drops the extension.
2. Open your browser's extensions page:
   - Chrome → `chrome://extensions`
   - Edge → `edge://extensions`
   - Opera → `opera://extensions`
3. Turn on **Developer mode** (top-right toggle in Chrome/Edge; left sidebar in Opera).
4. Click **Load unpacked** and select the **`tldw-extension`** folder.
5. Pin the tldw icon and open it. A short setup wizard runs on first launch: pick
   your languages and theme, then paste your **OpenRouter key**
   (get one at <https://openrouter.ai/keys>) and finish.

That's it. Open any page with a video and click the tldw icon to summarize it.

## Notes

- **Your key stays on your machine.** Keys are stored in the browser's local
  storage, never in the archive, and are never sent anywhere except OpenRouter.
- **Updating.** Unpacked extensions don't auto-update. To move to a newer version,
  replace the `tldw-extension` folder with the new one and click **↻ reload** on
  the tldw card in the extensions page.
- **Windows/macOS/Linux** are all fine — the archive is the same everywhere.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "No video found" | Start playback, then reopen the popup — or click the **⟳ rescan** button. Detection runs on the live page. |
| "OpenRouter key missing" | Open **⚙️ Settings** and paste your key. |
| The extension vanished | The `tldw-extension` folder was moved or deleted — Load unpacked again from its new location. |
