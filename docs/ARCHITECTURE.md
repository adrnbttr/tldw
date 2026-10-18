# Architecture

tldw is a Manifest V3 extension with no backend. Everything runs in the browser;
network calls go straight from the extension to the user's own providers (OpenRouter,
optionally OpenAI) and to the video hosts.

## Overview

```
 PAGE (every frame, incl. cross-origin iframes)
 ┌───────────────────────────┐
 │ content script            │  detects <video>, shadow DOM, embeds, facades
 │  src/content/             │  one list per frame, deduplicated by video key
 └──────────┬────────────────┘
            │ VIDEOS_DETECTED (per frame)          ▲ PRIME_MEDIA · FETCH_TEXT · REPORT_VIDEOS
            ▼                                      │
 SERVICE WORKER (src/background/)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ tab-videos       per-tab, per-frame lists (+ session storage mirror)         │
 │ media-capture    webRequest: records media URLs per tab/frame                │
 │ orchestrator     ONE job map (id → job), liveByKey (video key → live job)    │
 │                  cascade · cancel · progress · persistence · history cache   │
 │ keepalive        API ping every 20 s while ≥ 1 job runs                      │
 │ audioQueue       (transcription/) audio jobs strictly one at a time          │
 └───────┬──────────────────────────────┬──────────────────────────┬───────────┘
         │ JOB_STATE (broadcast)        │ OFFSCREEN_TRANSCRIBE     │ HTTPS
         ▼                              ▼                          ▼
 POPUP (Preact)                OFFSCREEN DOCUMENT          OpenRouter  (summary)
 list · progress · result      download (HLS, ranges,      YouTube/Vimeo  (captions,
 history · batch · settings    Vimeo master) → ffmpeg.wasm   oEmbed, media files)
 ──▲── LIST_VIDEOS · RESCAN    windows → chunk-runner ──▶  OpenRouter audio / OpenAI
     GET_JOBS · SUMMARIZE …    port 'tldw-offscreen-job'      Whisper (transcription)
```

## The cascade

Every path produces the same normalized `Transcript` (`src/types/transcript.ts`), so
the summarizer neither knows nor cares where the text came from.

```
Level 1 — captions (adapter exists: YouTube, Vimeo)
   YouTube : watch-page caption tracks → InnerTube → json3 timedtext (page-context retry)
   Vimeo   : player config text_tracks → VTT
        │ NO_CAPTIONS_AVAILABLE / CAPTIONS_BLOCKED
        ├── YouTube ──▶ Gemini watches the video URL (no Transcript; source `youtube_video`)
        └── others  ──▶ Level 2
Level 2 — audio: capture → download → ffmpeg.wasm → chunks → transcription
        │ failure
Level 3 — typed TldwError (code + detail) shown in the popup
```

A native `<video>`, Drive file or hosted player has no caption adapter and starts at
level 2. Summaries are then produced by `summarize()` (long transcripts are condensed
block by block first) or, for the YouTube video path, `summarizeYouTubeVideo()`.

## Components

| Component | Role | Runs in |
|---|---|---|
| `content/` | Detection: `detect.ts` (pure URL/DOM helpers), `observe.ts` (cheap mutation filter), `index.ts` (wiring, `PRIME_MEDIA`) | Page, all frames |
| `background/tab-videos.ts`, `frame-videos.ts` | Per-tab/frame video lists, merge and dedupe across frames, survive worker restarts | Service worker |
| `background/media-capture.ts` | Records media URLs (HLS/DASH/MP4/segments/Vimeo CDN/`videoplayback`) per tab and frame; mirrored to `storage.session` | Service worker |
| `background/orchestrator.ts` | Job registry, cascade, watchdogs, cancel, progress, persistence (`job-store.ts`) | Service worker |
| `background/keepalive.ts` | Keeps the worker alive while a job runs | Service worker |
| `background/log*.ts`, `diagnostics-handler.ts` | Single writer of the log buffer; diagnostic report | Service worker |
| `adapters/` | Caption extraction per provider (`youtube.ts`, `vimeo.ts`, `tracks.ts` track choice) | Service worker |
| `transcription/` | `Transcriber` interface, source selection (`sources.ts`), queue and offscreen lifecycle (`offscreen-session.ts`), chunk loop, OpenRouter/Whisper clients | Worker + offscreen |
| `offscreen/` | Download, ffmpeg.wasm window extraction, transcription; holds a liveness port to the worker | Offscreen document |
| `summarizer/` | OpenRouter call, condensation, versioned template → Markdown | Service worker |
| `storage/` | Settings and history (`chrome.storage.local`) | Extension |
| `popup/` | UI; `batch.ts`, `job-match.ts`, `progress-text.ts`, exports (PDF/DOCX) | Popup |
| `i18n/` | Typed catalogs en/fr/es/de: UI, errors, template headings | Popup + shared |
| `shared/` | `video-key.ts`, `job-progress.ts`, `logger.ts` (redaction), `diagnostics.ts`, `http-error.ts` | All |
| `types/` | The contracts: `Transcript`, `DetectedVideo`, errors, messages, settings/model registry | — |

## Messages

Typed in `src/types/messages.ts` and `src/transcription/offscreen-protocol.ts`.

| Direction | Message | Allowed sender | Purpose |
|---|---|---|---|
| popup → SW | `LIST_VIDEOS` | extension page | Videos of the active tab (asks frames to republish if the worker is fresh; waits for a verification in flight) |
| popup → SW | `RESCAN` | extension page | Force detection; sweep silent frames; inject the script if none is present |
| popup → SW | `GET_JOBS` | extension page | All known jobs with their video key (rehydrates the popup) |
| popup → SW | `SUMMARIZE` / `SUMMARIZE_BATCH` | extension page | Start one job / register N queued jobs (the tab is fixed on receipt); `force` regenerates, bypassing the cache |
| popup → SW | `CANCEL` | extension page | Cancel a running or queued job |
| popup → SW | `GET_DIAGNOSTICS` / `CLEAR_LOGS` | extension page | Report / clear logs |
| SW → popup | `JOB_STATE` (broadcast) | service worker | New state of a job; fire-and-forget |
| content → SW | `VIDEOS_DETECTED` | content script (in a tab) | The sender frame's own list (empty = retraction) + `frameKey`, its own-URL identity; tab and frame come from the sender, the payload is shape- and size-checked |
| any → SW | `LOG` | any context of the extension | One redacted log line; validated and re-redacted by the worker |
| SW → content | `PRIME_MEDIA` | service worker | Briefly play a video muted so its stream is requested |
| SW → content | `FETCH_TEXT` | service worker | Fetch a URL from the page origin (YouTube timedtext); top frame only |
| SW → content | `REPORT_VIDEOS` | service worker | Republish the list (after a worker restart or a rescan) |
| SW → offscreen | `OFFSCREEN_TRANSCRIBE` | service worker only (`isServiceWorkerSender`) | One audio job (`jobId` unique per run, sources best-first, keys, models) |
| offscreen → SW | `OFFSCREEN_PROGRESS` | extension page (offscreen) | `phase` download / extract / transcribe, detail, duration, measured `data` |
| offscreen → SW | `OFFSCREEN_RESULT` | extension page (offscreen) | Terminal: segments (+ `partial`) or `{code, message, retryAfter}` |
| offscreen ⇄ SW | port `tldw-offscreen-job` | offscreen (our id, no tab) | No payload: its disconnection tells the offscreen job the worker died, so it aborts |

Senders are checked in `src/background/sender-guard.ts`: an **extension page** carries our
runtime id and a `chrome-extension://<id>/` URL or origin (popup, offscreen); a **content
script** carries our id and a tab, with a web page URL. A content script — any frame of any
page — can therefore neither read jobs and summaries, nor start paid jobs, nor cancel them,
nor drive the offscreen document. The full table is also kept next to the router, in
`src/background/index.ts`.

Offscreen messages are matched on the per-run `jobId`, never on the video id, so a stale
run can not be mistaken for the current one.

## Job lifecycle

`JobState.phase` is `idle | running | done | error`. “Queued”, “cancelled” and
“interrupted” are refinements, not extra phases:

```
            runJob()
 idle ──────────────▶ running ─┬─ progress.phase = queued   waiting behind a batch item
                               │   or an earlier audio job (`ahead` = jobs in front)
                               ├─ steps: detect → captions → audio_capture
                               │          → transcription → summarize
                               ├──▶ done          summary (cached in history unless
                               │                  partial / not attributable audio)
                               ├──▶ error CANCELLED     user pressed Cancel (neutral)
                               ├──▶ error INTERRUPTED   worker restarted mid-job
                               └──▶ error <code>        TldwError from any layer
```

- **Single registry.** One `Map` of jobs by local id, plus `liveByKey` (video key → live job
  id). Starting a video already running or queued joins that job. A new run replaces the
  video's earlier terminal states.
- **Batch.** `runBatch` registers every video at once (all visible and cancellable) and chains
  them: item *n* starts when item *n−1* settles, regardless of its outcome.
- **Audio queue.** One offscreen document and one ffmpeg instance: audio jobs run through
  `audioQueue` one at a time, even when started separately. Media sources are resolved only
  once the slot is free (signed URLs expire). The offscreen document is closed when the queue
  empties, or at once after an abnormal end (which kills any work the worker no longer awaits).
- **Cancel** is synchronous: the run is detached and aborted, the key is freed, the state set
  to `CANCELLED`, and whatever the dying run still produces is dropped (every write checks the
  job's *current* run).
- **Persistence.** Each state change is mirrored (throttled: broadcast ≤ 4×/s, write ≤ once per
  2 s for detail updates) to `chrome.storage.session`. A revived worker reloads the snapshot
  (`restoreJobs`, awaited by every handler): a job still `running` becomes `INTERRUPTED`
  (never resumed — its streams and timers died); a `done` job is restored from its history entry.
  At most 50 jobs / 6 h of terminal jobs are kept.
- **Keepalive.** While any job holds it, a trivial extension API call runs every 20 s, which
  resets MV3's idle timer. A new worker also closes any orphan offscreen document.
- **Watchdogs.** Captions and summary: `withDeadline` (base timeout, `timeoutSeconds`, default
  15 min). Audio: 120 s inactivity + overall cap for download/extraction, then a budget
  proportional to the media duration for transcription. Values in
  [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md#4--time-budgets-progress-queue).

## Identity: the video key

`DetectedVideo.id` is stable only for an element's lifetime in its document. The stable
identity is `videoKey()` (`src/shared/video-key.ts`):

| Case | Key |
|---|---|
| Host id known | `provider:externalId` (e.g. `youtube:dQw4w9WgXcQ`) |
| No id, URL known | `provider:#<fnv1a(url)>` — hashed so a signed URL never reaches storage or a report |
| Neither | `id:<local id>` |

It is used to deduplicate frames in the worker, to join live jobs, to let the popup find a job
after a rescan (`GET_JOBS` returns the key), and — plus the output language — as the history
cache key.

## Progress model

`src/shared/job-progress.ts` computes a monotonic 0–100 % in the worker from the phase events
the pipeline already emits (`JobPercent`: `percent`, `phase`, `done/total/unit`, `ahead`,
`etaSeconds`).

| Path | Phases and weights |
|---|---|
| Captions | captions 0→15, summary 15→100 |
| Audio | queued 0, download 0→30, extract 30, transcription 30→85, summary 85→100 |
| YouTube video URL | summary 0→100 |

Phases without a measured size creep asymptotically towards a cap (download 28, summary 97);
the bar never exceeds 99 before `done`. The ETA appears only during transcription, once the rate
is stable and the bar is past 10 %. The step list (`JobStep`: detect, captions, audio_capture,
transcription, summarize) is the coarse companion of the percentage.

## The audio pipeline (offscreen)

```
select sources ─▶ download ─▶ ffmpeg.wasm ─▶ per-window mono 16 kHz MP3 (64 kbps) ─▶ transcribe ─▶ merge
 (own URL, Vimeo     HLS · progressive ·     memory: source written once,            OpenRouter: chunks ≤ 12 min,
  config, captures   googlevideo byte        peak ≈ 2× the file,                     sequential, no overlap, retried;
  scoped to frame)   ranges · Vimeo master   limit 1 GiB                             Whisper: windows ≤ 24 MiB, 5 s overlap
```

- Source choice (`sources.ts`): a native `<video>`'s own http(s) URL; else Vimeo's config; else
  captured requests (googlevideo streams reserved to Drive; narrowed to the video's frame). When
  the sources cannot be tied to the video, the summary is shown but not cached.
- `PRIME_MEDIA` starts the video muted (~4.5 s) when nothing whole has been captured, then the
  captures are re-read (5 s wait). Still nothing → `MEDIA_NEEDS_PLAYBACK`.
- DASH-only streams are not assembled (`MEDIA_NOT_CAPTURABLE`); 401/403 maps to `MEDIA_PROTECTED`.
- ffmpeg uses the single-threaded core: no `SharedArrayBuffer`, no COOP/COEP; the extension CSP
  only needs `wasm-unsafe-eval`. If the media is under 80 % of the page's duration the transcript
  is flagged `partial`.

## Key design decisions

- **The `Transcript` object is the contract.** Adapters and the audio fallback produce it; the
  summarizer only consumes it.
- **The model never controls formatting.** It returns structured JSON (`SummaryContent`,
  strict `json_schema` when the model supports it); Markdown is rendered locally from a versioned
  template (`src/summarizer/template.ts`). Length (Short / Standard / Detailed) is applied at
  render time over one rich generation, so switching it costs nothing.
- **Condensation is model-aware.** A transcript is condensed (blocks of ≤ 100k chars, 3 in
  parallel) only above half the model's context window (chars ≈ tokens × 4); an unknown model
  uses 60k chars. A `CONTEXT_TOO_LONG` answer triggers one retry with condensation.
- **The audio fallback is isolated** behind `Transcriber` (`src/transcription/index.ts`).
- **Jobs live in the service worker**, the popup is a view: it re-subscribes and restores on reopen.
- **No silent failure.** Every error is a `TldwError` with a code; the popup maps it to a localized,
  actionable message, with an English fallback in `src/types/errors.ts`.
- **Localization is type-safe.** Every locale implements `Messages`; a test also asserts key parity.

## Storage

| Where | Key | Content |
|---|---|---|
| `storage.local` | `settings` | Preferences and API keys |
| `storage.local` | `history` | Summaries (default 50), keyed by video key + output language |
| `storage.local` | `tldw.logs` | Redacted rolling log (≤ 500 entries, ≈ 256 KiB) |
| `storage.session` (RAM, cleared when the browser closes) | `tldw.jobs` | Job states (done jobs by reference) |
| `storage.session` | `frames:<tabId>` | Last video list of each frame, per tab |
| `storage.session` | `tldw:mediaCaptures` | Captured media URLs per tab (may be signed) |
| `storage.session` | `popup.batchKeys` | Video keys of the running “Summarize all” batch |

## Directory layout

```
src/
├── background/    service worker: orchestrator, tab-videos, media-capture, keepalive, logs
├── content/       DOM detection (detect.ts pure helpers, observe.ts, index.ts)
├── popup/         Preact UI, exports, batch/job matching
├── adapters/      youtube.ts · vimeo.ts · tracks.ts · registry
├── transcription/ Transcriber, sources, queue/offscreen session, chunking, providers
├── offscreen/     download.ts · worker-link.ts · index.ts (ffmpeg pipeline)
├── summarizer/    openrouter.ts · template.ts · condensation
├── storage/       settings + history
├── shared/        video-key, job-progress, logger, diagnostics, safe-url…
├── i18n/          en · fr · es · de
└── types/         contracts (single source of truth)
```
