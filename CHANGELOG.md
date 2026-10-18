# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-10-18

### Fixed

- **Video detection works on every site again.** In 0.3.0 the content script could only
  load on Google Drive (two manifest entries on the same file made the bundler restrict
  its web-accessible resources), so YouTube, Vimeo and native videos were not detected.
  A single entry now runs in every frame, and `release:check` verifies the loader can
  load everywhere.
- **Default models replaced before retirement.** `google/gemini-2.5-flash` is retired on
  OpenRouter on 2026-10-20 and `anthropic/claude-sonnet-4` is gone. Defaults move to
  `google/gemini-3.1-flash-lite`; retired models in existing settings are migrated
  automatically, valid custom choices are kept.
- **Long audio jobs are reliable.** The service worker is kept alive for the whole job;
  if it dies anyway, the offscreen document stops (no credits spent for nothing) and
  orphan documents are closed. Audio jobs run one at a time in a queue, the same video
  is never processed twice, a short or silent final chunk no longer loses the whole
  transcript, the download uses an inactivity timeout instead of a fixed 10-minute cap,
  and memory is bounded during the download.
- **Never the wrong video.** The tab is fixed when you click, captures from another page
  or player are not reused, a lone stream segment is never taken for the whole video,
  and partial or uncertain transcripts are not cached.
- **Cancel is a real cancel** (also for queued and batch items), shown as a neutral
  "Cancelled" state; every phase has a time limit, so a job can no longer hang at 97 %.
- **Audio is transcribed in its spoken language** instead of being translated into the
  summary language.
- **Privacy:** signed URLs, path tokens, IP addresses, Drive file ids and ffmpeg
  metadata (GPS, titles) no longer reach logs or the diagnostic report.
- **Security:** popup-only commands and offscreen requests are refused from any other
  sender; detection messages are validated and scoped to their own frame.
- History entries no longer overwrite each other (native videos, concurrent saves), and
  the summary cache now accounts for output language and model.

### Added

- **Progress bar** on every running video: percent, phase in plain words (e.g.
  "Transcription · 24:10 / 58:30 de vidéo"), queue position and a time-remaining
  estimate; it survives closing and reopening the popup.
- **Much broader detection:** videos inside cross-origin iframes (Wistia, Loom,
  Dailymotion, Brightcove, JW Player, Kaltura, Panopto, Streamable, Twitch…), shadow-DOM
  players, click-to-play facades (`lite-youtube`, lazy `data-src` iframes, Plyr),
  YouTube Shorts / live / mobile URLs, Vimeo channels and showcases, players revealed
  later (tabs, accordions, modals); ads, hidden and decorative videos are ignored. The
  list survives the service worker restarting and single-page navigation.
- **Actionable errors:** distinct messages for an invalid key, missing credits, rate
  limits (with a live countdown), an unavailable model or an invalid transcription key,
  with **Open settings** / **Add credits** buttons and collapsible technical details.
- **Regenerate** a summary, delete history entries, and **Clear history** in Settings.
- Summary headings, labels and durations follow the output language (also in PDF and
  Word exports).
- `npm run test:e2e` (65 detection cases) and `npm run test:e2e:pipeline` (full audio
  pipeline with stubbed APIs) run in headless Chromium and gate every release.

### Changed

- Popup polish: accessible contrast in both themes, localized numbers and plurals,
  reviewed French/German/Spanish copy, empty and loading states, key field with
  show/hide, visible keyboard focus.
- Long transcripts are summarized in a single call when the model's context allows
  (model-aware threshold), with parallel condensation otherwise and a JSON-mode
  fallback.
- Faster popup after the service worker restarts (≈ 45 ms instead of up to 850 ms) and
  a lighter content script on heavy pages; the network listener no longer wakes the
  worker on every request.
- Documentation rewritten (README, install, architecture, privacy, new troubleshooting
  guide); release procedure commits before checking and fails fast.

## [0.3.0] - 2026-10-17

### Added

- **Google Drive videos.** Drive players are detected, the underlying `googlevideo`
  stream is captured, and the audio is downloaded by HTTP ranges so long files can be
  transcribed. The content script also runs inside Drive's nested player iframes
  (`drive.google.com`, `youtube.googleapis.com`) so the player can be driven.
- **Windowed audio for 1-hour videos.** Audio extraction and transcription now work on
  bounded windows instead of the whole file, keeping memory flat on long videos.
- **Resilient long jobs.** OpenRouter requests are retried on transient failures,
  each phase has its own timeout, and running jobs are persisted so they survive the
  service worker being suspended.
- **Diagnostic report.** Settings -> Diagnostic -> Copy / Download / Clear: a report
  assembled from logs persisted across every context (worker, offscreen, content,
  popup), with secrets and signed URLs masked. Everything stays local, nothing is
  ever sent. A logging core (redaction, persistent buffer) backs it, with
  instrumentation of the critical paths.
- **Release tooling.** `npm run build:test` and `npm run release:check` gate a
  release, packaging no longer requires the `zip` binary, and `docs/RELEASING.md`
  documents the procedure.

## [0.2.0] - 2026-07-30

### Added


- **Multi-video dashboard.** The popup list is now a live dashboard: every video on
  the page shows its status inline (idle · summarizing… · done), each result is one
  click away (**View**), a **Summarize all (n)** action processes them together, and a
  combined **PDF** collects them — no more losing track when a page has several videos.
- **Adjust length on the result.** A Short / Standard / Detailed switch on the summary
  regenerates it in place at the chosen length — reusing the cached source (transcript
  or the YouTube video) so only the model re-runs, no re-download or re-transcription.
- **Duration-aware summary length.** A summary now stays scannable whatever the video
  length: the **Summary length** setting (Short / Standard / Detailed) sets a word and
  section budget, nudged by the video's duration within a strict cap — a 1-hour video
  no longer produces pages. Cleaner labels; the setting drives all summary paths.
- **YouTube via Gemini vision.** YouTube now blocks caption downloads (proof-of-origin
  tokens). When captions are unavailable, tldw sends the YouTube URL to Gemini through
  OpenRouter (routed to Google AI Studio, which accepts YouTube links) and Gemini
  watches the video to produce the summary — using the same single OpenRouter key.

- **PDF & Word export.** One-click, nicely formatted **PDF** (primary) and **Word
  (.docx)** documents built from the structured summary — headings, bullet lists,
  bold glossary terms — localized in the output language. Batch export produces a
  single combined PDF. The technical Markdown download was dropped from the UI;
  Copy now yields clean plain text.
- Wider popup (460px) and a cleaner processing view: the step detail sits on its own
  line and single-block transcription shows a plain label instead of "1/1 · 0:00".
- **Auto-start for the audio fallback.** When a video has no captions and no media
  has been captured yet, tldw briefly plays it muted (via the page player) to
  trigger the stream, so the user no longer has to press play first. If the browser
  blocks autoplay, a clear `MEDIA_NEEDS_PLAYBACK` message asks them to play a couple
  of seconds — instead of the misleading "host not supported".
- **Single-provider audio transcription.** The audio fallback now transcribes via
  OpenRouter (Gemini multimodal) by default, so one OpenRouter key covers both
  summaries and transcription — no separate OpenAI/Whisper account needed. Whisper
  remains selectable in Settings for word-level timings.
- **Duration & title for embedded videos.** Cross-origin Vimeo/YouTube embeds now
  show their real duration and title in the list, enriched from the providers'
  public oEmbed endpoints (cached, no key).
- **Internationalization (en/fr/es/de).** Fully localized popup, typed error
  messages, step labels, and summary template headings. Interface language and
  summary-output language are chosen independently; the first run defaults to the
  browser's UI language. Locale key parity is enforced at compile time and by a test.
- **Support for any native `<video>`.** Sites beyond YouTube/Vimeo are summarized via
  the audio fallback when the media is DRM-free; the content script captures the
  native media URL and the orchestrator skips straight to transcription.
- Repo hygiene: `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.editorconfig`, Dependabot,
  `docs/SCREENSHOTS.md`, and a one-command `install.sh`.

### Fixed

- The popup now restores a running job or batch after being closed and reopened
  (jobs were keyed by an ephemeral detection id).

### Initial foundations

- **Phase 1 — Core & nominal path.** Video detection (`MutationObserver`), YouTube
  caption adapter, OpenRouter summary generation with a versioned template, Preact
  popup (list / processing / result / settings), Markdown export and clipboard copy,
  settings and history storage.
- **Phase 2 — Vimeo level 1.** Vimeo detection and `text_tracks` retrieval with a
  clean fallthrough to a typed error when no track exists.
- **Phase 3 — audio transcription fallback.** Media capture via `chrome.webRequest`,
  Vimeo progressive/HLS source resolution, audio isolation with `ffmpeg.wasm`
  (single-threaded core) in an offscreen document, chunking with overlap under the
  Whisper size limit, sequential transcription with reassembly and overlap
  de-duplication, temp-file cleanup, and a configurable global timeout. End-to-end
  extraction is pending validation against a real DRM-free stream.
- **Phase 4 — polish.** Batch processing (select several videos, single
  concatenated `.md` export), a browsable summary history in the popup, a second
  selectable summary template (`compact`), and finer quota handling (HTTP 429/402
  with `Retry-After` surfaced to the user).
- Normalized `Transcript` contract shared across all extraction paths.
- Isolated `Transcriber` interface for the audio fallback.

[Unreleased]: https://github.com/adrnbttr/tldw/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/adrnbttr/tldw/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/adrnbttr/tldw/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/adrnbttr/tldw/releases/tag/v0.2.0
