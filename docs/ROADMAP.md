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

## Phase 3 — Audio transcription fallback

The most delicate part, isolated behind the `Transcriber` interface.

- [ ] Media segment capture via `chrome.webRequest` (F5.1)
- [ ] Segment download in the authenticated context (F5.2)
- [ ] Audio isolation with `ffmpeg.wasm` (F5.3)
- [ ] Chunking with overlap under the 25 MB Whisper limit (F5.4)
- [ ] Sequential transcription + reassembly/de-duplication (F5.5)
- [ ] Guaranteed temp-file cleanup, incl. on error
- [ ] Configurable global timeout (default 15 min)

**Validation:** a Vimeo video without captions yields a summary using the *same*
template.

## Phase 4 — Polish

- [ ] Batch processing (single concatenated file or archive) (F8)
- [ ] History browser in the popup
- [ ] Multiple templates
- [ ] Fine-grained quota handling

## Open questions

Tracked in the [spec](./SPEC.md) §7: transcription provider (Whisper vs Deepgram),
Firefox MV3 support, a possible single-call Gemini audio path, and default video
language.
