# Roadmap

Development follows the phasing in the [functional spec](./SPEC.md) (§5).

## Phase 1 — Core & nominal path ✅ (current)

Detection, YouTube adapter, OpenRouter summary, popup, export.

- [x] Video detection with `MutationObserver` (F1)
- [x] YouTube caption adapter (F3)
- [x] Normalized `Transcript` contract (F6)
- [x] Structured-JSON summary + versioned template → Markdown (F7)
- [x] Popup: list · processing · result · settings (F2)
- [x] Markdown download + clipboard copy (F8)
- [x] Settings & history storage (F9)

**Validation:** a template-conformant summary is produced from a YouTube video
embedded in an authenticated page.

## Phase 2 — Vimeo adapter (level 1)

- [x] Vimeo detection & `text_tracks` retrieval (F4)
- [x] Clean fallthrough to a typed error when no track exists

## Phase 3 — Audio transcription fallback 🧪 (implemented, pending real-stream validation)

The most delicate part, isolated behind the `Transcriber` interface and run in an
offscreen document (the service worker has no DOM).

- [x] Media segment capture via `chrome.webRequest` (F5.1)
- [x] Segment/stream download in the authenticated context (F5.2)
- [x] Audio isolation with `ffmpeg.wasm`, single-threaded core (F5.3)
- [x] Chunking with overlap under the 25 MB Whisper limit (F5.4)
- [x] Sequential transcription + reassembly/de-duplication (F5.5)
- [x] Temp-file cleanup, incl. on error
- [x] Configurable global timeout (default 15 min)
- [ ] **End-to-end validation against a real DRM-free stream** — the pipeline is
      wired and unit-tested, but ffmpeg.wasm under the extension CSP and live media
      extraction still need to be confirmed on a real target. Follow
      [`TESTING.md`](./TESTING.md) §3.

**Validation target:** a Vimeo video without captions yields a summary using the
*same* template.

## Phase 4 — Polish ✅

- [x] Batch processing — select several videos, single concatenated `.md` export (F8)
- [x] History browser in the popup — reopen a past summary without reprocessing (F9)
- [x] Multiple templates — `default` and `compact`, selectable in Settings (F7)
- [x] Fine-grained quota handling — 429/402 + `Retry-After` surfaced to the user

## Beyond the spec

Shipped on top of the original functional spec:

- [x] **Internationalization** — English, Français, Español, Deutsch, for both the UI
      and the summary output (headings included)
- [x] **Any native `<video>`** — sites beyond YouTube/Vimeo are summarized through the
      audio fallback when the media is DRM-free
- [x] **State restore on reopen** — a running job or batch is restored when the popup
      is closed and reopened
- [ ] More caption adapters (Dailymotion, Wistia, …) — the `Adapter` interface makes
      these additive
- [ ] Real-extension screenshots in the README (see [`SCREENSHOTS.md`](./SCREENSHOTS.md))

## Open questions

Tracked in the [spec](./SPEC.md) §7: transcription provider (Whisper vs Deepgram),
Firefox MV3 support, a possible single-call Gemini audio path, and default video
language.
