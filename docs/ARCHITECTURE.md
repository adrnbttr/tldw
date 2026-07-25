# Architecture

tldw is a Manifest V3 extension with no backend. Everything runs in the browser;
network calls go straight from the extension to the user's own API providers.

## The best-effort cascade

The extension tries to obtain the video's text in successive levels, dropping one
rung on each failure. **Every level produces the same normalized `Transcript`
object**, so the summarizer never knows — or cares — where the text came from.
This is what guarantees an identical output formalism whatever path is taken.

A provider with a caption adapter (YouTube, Vimeo) tries level 1 first; a plain
native `<video>` on any other site has no caption adapter and drops straight to
level 2.

```
Level 1 — Caption track
  ├── YouTube : manual or automatic captions
  └── Vimeo   : text_tracks if present
        └── fail (NO_CAPTIONS_AVAILABLE) or no adapter ↓
Level 2 — Audio extraction + transcription
  ├── capture media segments (chrome.webRequest)
  ├── isolate the audio track (ffmpeg.wasm)
  └── transcribe (Whisper), reassemble
        └── fail ↓
Level 3 — Explicit typed error
```

## Components

| Component | Role | Runs in |
|---|---|---|
| `content/` | Detect videos in the DOM (F1) | Page |
| `background/` | Orchestration, messaging, job state, media capture | Service worker |
| `popup/` | UI: list · processing · result · settings (F2) | Extension |
| `adapters/` | Per-provider caption extraction (F3, F4) | Background |
| `transcription/` | Audio fallback, isolated behind a stable interface (F5) | Background + offscreen |
| `offscreen/` | Runs ffmpeg.wasm + Whisper off the worker (has a DOM) | Offscreen document |
| `summarizer/` | OpenRouter call + versioned template → Markdown (F7) | Background |
| `storage/` | API keys, preferences, history (F9) | Extension |
| `i18n/` | Typed message catalogs (en/fr/es/de); UI + errors + template headings | Popup + shared |
| `types/` | The shared contracts: `Transcript`, `DetectedVideo`, errors, messages | — |

## Key design decisions

- **The `Transcript` object is the contract** (`src/types/transcript.ts`). Adapters
  and the audio fallback both produce it; the summarizer only consumes it.
- **The model never controls formatting.** It returns structured JSON
  (`SummaryContent`); Markdown is rendered locally from a versioned template
  (`src/summarizer/template.ts`). Two summaries via different paths are structurally
  identical.
- **The audio fallback is strictly isolated** behind the `Transcriber` interface
  (`src/transcription/index.ts`) — the most fragile part of the project can be
  swapped without touching anything else. Its pipeline runs in an **offscreen
  document** because the MV3 service worker has no DOM:
  ```
  resolve source → download → ffmpeg.wasm (mono 16 kHz MP3)
    → chunk with overlap → Whisper per chunk → merge & de-duplicate → Transcript
  ```
  Media sources come from the Vimeo player `config` (progressive/HLS) and from
  URLs observed by `chrome.webRequest` (`background/media-capture.ts`). The
  single-threaded ffmpeg core is used on purpose — no `SharedArrayBuffer`, so no
  COOP/COEP headers are required; the extension CSP only needs `wasm-unsafe-eval`.
- **Jobs live in the service worker.** The popup subscribes to broadcasts and
  restores state on reopen, so processing survives the popup closing (F2).
- **No silent failure.** Every error carries a typed code; the popup maps that code
  to a localized, actionable message (`src/i18n`), with an English fallback in
  `src/types/errors.ts`.
- **Localization is type-safe.** Every locale implements the `Messages` interface,
  so a missing or misspelled key fails the build; a runtime test also asserts key
  parity. UI language and summary-output language are chosen independently.

## Message flow

```
content  ──VIDEOS_DETECTED──▶ background (caches per tab)
popup    ──LIST_VIDEOS──────▶ background ──▶ videos
popup    ──SUMMARIZE────────▶ background : runJob() in the worker
background ──JOB_STATE / JOB_PROGRESS (broadcast)──▶ popup
```

## Directory layout

```
src/
├── background/   service worker + orchestrator (the cascade)
├── content/      DOM detection (pure helpers in detect.ts)
├── popup/        Preact UI + components
├── adapters/     youtube.ts, vimeo.ts, registry
├── transcription/ audio fallback interface (Phase 3)
├── summarizer/   openrouter.ts, template.ts, hierarchical summarization
├── storage/      chrome.storage wrappers
├── shared/       format & markdown helpers
└── types/        contracts (single source of truth)
```
