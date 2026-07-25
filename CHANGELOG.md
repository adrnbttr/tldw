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
- Normalized `Transcript` contract shared across all extraction paths.
- Isolated `Transcriber` interface for the upcoming audio fallback (Phase 3).

[Unreleased]: https://github.com/adrnbttr/tldw/commits/main
