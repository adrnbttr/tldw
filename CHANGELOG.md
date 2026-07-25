# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
