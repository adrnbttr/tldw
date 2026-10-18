# Installing tldw

tldw is installed as an **unpacked extension**: there is no Web Store listing and
nothing to compile if you use a release archive. It takes about a minute.

## What you need

| Item | Notes |
|---|---|
| A Chromium browser, **version 116 or later** | Chrome, Edge, Brave, Opera, Arc |
| The tldw archive | `tldw-vX.Y.Z.zip` from the [GitHub releases](https://github.com/adrnbttr/tldw/releases) page (or a `tldw-share-vX.Y.Z.zip` someone sent you, see below) |
| An [OpenRouter](https://openrouter.ai/keys) API key with a little credit | Each user brings their own; it is never inside the archive |

## Install

1. **Unzip** the archive into a folder you will **keep**. The release zip has the
   extension files at its root, so unzip into a new, empty folder (for example
   `tldw`). The `tldw-share-…` archive already contains a `tldw-extension/` folder.
   If you later move or delete the folder, the browser drops the extension.
2. Open the extensions page: `chrome://extensions` (Chrome, Brave), `edge://extensions`
   (Edge), `opera://extensions` (Opera).
3. Turn on **Developer mode** (top-right toggle; left sidebar in Opera).
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Pin the tldw icon from the puzzle-piece menu and click it.

## First run

A five-screen wizard opens the first time (replayable from **Settings → Replay the intro**):

| Screen | What to do |
|---|---|
| Welcome | Next |
| Your languages | Interface language and summary language (default: your browser's language) |
| Pick a look | System, light or dark |
| Connect OpenRouter | Paste your key (it should start with `sk-or-`); you can skip and add it later in Settings |
| You're all set | Open a page with a video, click the icon |

Then: open a page with a video, play it for a moment, click the tldw icon, **Summarize**.
The default summary model is Gemini 3.1 Flash Lite; audio transcription uses the same
OpenRouter key, so there is nothing else to configure.

## Update

Unpacked extensions do not auto-update.

1. Download the new archive, unzip it **over the same folder** (or into a new one).
2. On the extensions page, click **↻ reload** on the tldw card (if you used a new folder:
   remove the old card and **Load unpacked** the new one).
3. Reload the pages where you want to use it.

Your key, settings and history stay in the browser profile and survive an update that
keeps the same extension ID (unzipping over the same folder). Loading from a different
folder creates a new extension with empty storage.

## Uninstall

On the extensions page, **Remove** on the tldw card. This deletes its keys, settings,
history and logs from the browser. Delete the unzipped folder afterwards if you want.

## Building from source

```bash
git clone https://github.com/adrnbttr/tldw.git && cd tldw
./install.sh          # npm install + build + guided walkthrough (Node ≥ 18, Node 20 recommended)
```

Load the `dist/` folder as above. To build a hand-install archive for a colleague:
`npm run share` (writes `tldw-share-vX.Y.Z.zip`; `npm run share:lite` drops the 30 MB
ffmpeg core, which disables the audio path — Drive, native `<video>` and hosted players
— and keeps YouTube/Vimeo caption summaries). Both need Python 3 on the PATH to write the
zip. Release procedure: [`RELEASING.md`](./RELEASING.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| “No video detected” | Play the video for a few seconds, then **Scan again**; reload the page if it was open before installing |
| “OpenRouter key missing” | **Settings** → paste your key |
| The extension vanished | The folder was moved or deleted: **Load unpacked** again from its new location |
| Other errors | See [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) |
