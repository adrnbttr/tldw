# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/adrnbttr/tldw/commits/main
