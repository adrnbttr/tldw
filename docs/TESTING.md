# Testing & validation guide

Two layers: an automated unit suite for the logic, and a hands-on checklist for what only a
real browser can confirm (detection on live pages, network behaviour, the offscreen audio
pipeline, the UI). The checklist doubles as the script for the README screenshots.

## 0 · Automated suite

```bash
npm test            # Vitest, ~570 tests in ~55 files, a few seconds
npm run lint        # ESLint + Prettier (also checks the Markdown docs)
npm run build       # tsc --noEmit + production build
```

CI runs the same three. The suite covers pure logic: URL parsing and detection helpers, frame
merging, video keys, job lifecycle (queue, cancel, interrupt, restart), progress model,
chunking, source selection, redaction and the diagnostic report, summarizer and OpenRouter
clients, i18n key parity, release checks. It does **not** cover live pages, ffmpeg.wasm, real
streams or the popup in a browser — that is §2.

## 1 · Setup for manual testing

```bash
npm install && npm run build:test    # prints the absolute path of dist/ and the build sha
```

Load `dist/` via `chrome://extensions` → **Developer mode** → **Load unpacked**. After each
rebuild click **↻ reload** on the tldw card. Add your OpenRouter key in **Settings** (a few
dollars of credit is plenty: see the cost table in the [README](../README.md#what-it-costs)).

### Where to look when something fails

First: **Settings → Diagnostic → Copy the report** (also offered on any error row). Then the
consoles, listed in [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md#6--where-to-look). To start clean:
run `await chrome.storage.local.clear()` in the service-worker console, then reload the extension.

## 2 · Scenarios

Start every audio scenario with a **short** video (2–5 min): it is one chunk and isolates the
plumbing from chunking and merging.

### 2.1 YouTube with captions (nominal)

1. Open a page with an embedded YouTube video (or a watch page), play it, open the popup.
2. **Expect** the video listed with a YouTube badge; **Summarize**.
3. **Expect** steps `Detection ✓ → Looking for captions ✓ → capture/transcription skipped →
   Generating the summary`, a progress bar that only moves forward, and a rendered summary with
   “Method: YouTube captions”.
4. Switch **Length** Short / Standard / Detailed: instant, no spinner, no network call.
5. **Download as PDF**, **Download as Word**, **Copy text** (plain text, no Markdown syntax).

Also: close the popup mid-job and reopen it (state and bar restored); a page with no video shows
the empty state with **Scan again**; no key → “OpenRouter key missing”.

### 2.2 YouTube without usable captions

Pick a video with captions disabled (or one where YouTube blocks them). **Expect** the captions
step to be recovered silently (no red failure), the message “Analyzing the video…”, and method
“YouTube video (Gemini)”. This path bills Gemini for the whole video: use a short one.

### 2.3 Vimeo

With captions → “Vimeo captions”. Without captions → the audio path (§2.4) on a Vimeo `master.json`
or progressive file.

### 2.4 Audio path: native `<video>`, hosted player, Drive

Precondition: a **DRM-free** stream. For each of: a plain HTML5 `<video>` on a non-YouTube site, a
hosted player in an iframe (Wistia, Loom, …), a Google Drive video (`/file/d/…/view` and an
embedded `/preview`):

1. Open the page; if the popup shows nothing, play the video for a few seconds and **Scan again**.
2. **Summarize** (the video is primed muted if no stream was captured yet).
3. **Expect** `Capturing the media stream` with `Downloading · x / y MB` (or segments), then
   `Extracting audio…`, `Transcription · 3:00 / 12:00 of video`, then the summary with method
   “Audio transcription”, and the same template structure as a caption-based summary (spec §6).
4. A 1-hour video: memory stays flat (the offscreen document holds the source once; check Chrome's
   Task Manager), the bar passes 30 % after the download and shows an ETA once stable.

### 2.5 Queue, cancel, restart

- Select 3 videos → **Summarize selection (3)**: all show as queued, run one after another, the
  batch bar advances, **Download all (n) as one PDF** at the end.
- Start two audio videos separately: the second shows “Waiting (1 video ahead)…”.
- **Cancel** a running job: it stops at once, state is neutral “Cancelled”, the video can be started
  again immediately. Cancel a queued one too.
- Start a video that is already running: no second job (it joins the first).
- While a job runs: `chrome://serviceworker-internals` → stop the worker (or reload the extension).
  **Expect** after reopening the popup: “Interrupted” with a retry (never an endless spinner).
- Summarize the same video again in the same language: instant, from history. History 🕘 lists past
  summaries and reopens them without reprocessing.

### 2.6 Errors

| Do | Expect |
|---|---|
| Wrong key | `INVALID_API_KEY` message with **Open settings** |
| Empty account | `INSUFFICIENT_CREDITS` with **Add credits** |
| Many rapid requests | `RATE_LIMITED` with a “Retry in N s” countdown when the provider sent `Retry-After` |
| Unplayable stream (DRM, or an expired signed URL) | `MEDIA_PROTECTED` / `MEDIA_NOT_CAPTURABLE` with technical details |
| Page whose video never started | `MEDIA_NEEDS_PLAYBACK` |

### 2.7 Languages

Settings → **Interface language** (Español / Deutsch…): applies instantly and persists. **Summary
language** → German: content and section headings come out in German.

## 3 · Detection coverage (automated e2e)

Detection is checked end to end by a headless-Chromium suite in `e2e/`: it loads the **built**
extension (`dist/`, copied to a temp dir) via Playwright, serves 65 fixture pages from two local
origins (ports 8931 / 8932, override with `TLDW_E2E_PORT_A` / `TLDW_E2E_PORT_B`), stubs
third-party hosts (YouTube, Vimeo, Wistia, ads…) so no network is needed, and asks the extension
itself what it detects (`LIST_VIDEOS`, `RESCAN`, exactly like the popup). Each fixture is graded
three ways: idle list, list after a rescan, and list when the popup is reopened.

```bash
npm run e2e:install   # once: downloads Playwright's Chromium (~150 MB, not in the repo)
npm run test:e2e      # builds, then runs the suite (~2 min, 3 parallel browsers)
```

Options (call `node e2e/run.mjs` directly): `--only=id1,id2`, `--json`, `--workers=N`,
`--dist=DIR`, no `--build` to reuse the current `dist/`. `CHROME=/path/to/chrome` overrides the
browser. Exit code is non-zero on any ✗ or uncaught page exception; the release gate runs it
(see [RELEASING.md](./RELEASING.md)). `npm run perf:e2e` measures the content-script cost on
heavy pages (report only).

What the fixtures cover:

| Case | Expected provider |
|---|---|
| YouTube watch page, `/embed/`, `/shorts/`, a `lite-youtube` facade, a thumbnail facade | `youtube` |
| Vimeo page and `player.vimeo.com` embed | `vimeo` |
| Drive `/view`, `/preview` in an LMS iframe | `drive` |
| Plain `<video>`, MSE/blob sources, `<video>` in (nested) open shadow roots, late-defined custom elements, SPA route changes, accordions / hidden players | `native` |
| Wistia / Loom / Dailymotion / Brightcove / JW / Kaltura / Panopto / Streamable / Twitch iframe | `native`, one entry (the iframe placeholder is replaced by the player's own `<video>` once it exists) |
| YouTube subscribe button or live-chat frame; ad frames | not listed |
| Closed shadow root | not detected (known limit, see the [roadmap](./ROADMAP.md)) |

**Adding a fixture**: append an entry to `FIXTURES` in `e2e/lib/fixtures.mjs`:
`{ id, html, expect: ['youtube:ID', 'native', …] }` (one token per expected entry; `native:any`
accepts any native entry; `expect: null` or `reportOnly: true` only reports). Optional: `wait`
(ms before grading), `flow(page)` (interactions, e.g. click, SPA navigation), `url` (override the
page URL), `expectTitle`, `expectMediaSrc`. Reproduce a real-world detection bug as a fixture
first, then fix it. The test clip `e2e/fixtures/clip.webm` (4 KB, 10 s VP9) is committed rather
than generated, so the suite needs no ffmpeg.

**Audio pipeline** (`npm run test:e2e:pipeline`, builds first; `node e2e/pipeline.mjs` reuses
`dist/`, `--only=ok,cancel,badkey,whisper`): runs the whole audio fallback in the built extension —
`SUMMARIZE` on a native `<video>` without captions → service worker → offscreen document →
download → ffmpeg.wasm → transcription → summary → history. The media is a 30 s WAV tone generated
at startup (port 8941, `TLDW_E2E_PIPELINE_PORT`). No key and no network: `openrouter.ai` and
`api.openai.com` are mapped to a local HTTPS stub (`--host-resolver-rules` +
`--ignore-certificate-errors`) using the **test-only** self-signed pair in
`e2e/fixtures/stub-cert/`. Scenarios: success (summary saved, one audio chunk + one summary
request, monotonic progress, offscreen closed), cancel mid-chunk (CANCELLED, offscreen closed, no
further request), OpenRouter 401 (`INVALID_API_KEY`), Whisper 401 (`INVALID_TRANSCRIPTION_KEY`).
The release gate runs it after the detection suite.

## 4 · Acceptance criteria (spec §6)

- [ ] Detects YouTube, Vimeo, Drive and native videos embedded in an authenticated page
- [ ] Processing continues when the popup is closed
- [ ] A caption-based and a transcription-based summary share the **same** structure
- [ ] Every error shows an explicit cause and a possible action
- [ ] API keys are sent only to the provider concerned (Network tab: `openrouter.ai`, and
      `api.openai.com` only if Whisper is selected; media/caption requests go to the video's own hosts)
- [ ] Temporary media is released at the end of a job, including on error and cancel (the offscreen
      document closes when the queue is empty)
- [ ] The summary is exportable as PDF and Word

## 5 · Screenshots for the README

Right-click the popup → **Inspect** to keep it open, then use your OS screenshot tool. Save PNGs to
`.github/assets/screenshots/`; the full list and tips are in [`SCREENSHOTS.md`](./SCREENSHOTS.md).

## 6 · Reporting

Open an [issue](https://github.com/adrnbttr/tldw/issues) with the diagnostic report (keys are masked,
but never paste one yourself). To package a build or cut a release, see
[`RELEASING.md`](./RELEASING.md).
