# Troubleshooting

Something failed, hangs, or looks wrong? Start at the top and stop when it is fixed.

## 1 · Quick checks

| Check | Why |
|---|---|
| The video is playing (or has played for a few seconds) | The audio path captures the stream from the page's own network traffic. |
| The page was loaded **after** tldw was installed or updated | Otherwise reload it. **Scan again** (↻ in the popup) re-detects without reloading when a content script is present. |
| **Settings** has an OpenRouter key and your account has credit | Almost every “it fails right away” is the key or the balance. |
| You are on Chrome/Edge ≥ 116 | `minimum_chrome_version` in the manifest. |

## 2 · Errors: what they mean, what to do

The popup shows a localized message; the code appears in the diagnostic report and under **Technical details**.

| Code | Meaning | What to do |
|---|---|---|
| `MISSING_OPENROUTER_KEY` | No key saved. | Settings → paste your key (starts with `sk-or-`). |
| `INVALID_API_KEY` | OpenRouter answered 401/403. | Re-copy the key; check it is enabled on [openrouter.ai/keys](https://openrouter.ai/keys). |
| `INSUFFICIENT_CREDITS` | HTTP 402. | Add credits at [openrouter.ai/credits](https://openrouter.ai/credits), retry. |
| `RATE_LIMITED` | HTTP 429 after retries. | Wait for the countdown in the message (the provider's `Retry-After`), retry. |
| `MODEL_UNAVAILABLE` | HTTP 404, “no endpoints”, or the model refuses the input. | Pick another summary model in Settings. |
| `CONTEXT_TOO_LONG` | The transcript does not fit the model, even after condensing. | Choose a model with a larger context (all registry models have ≥ 1M tokens). |
| `SUMMARY_API_ERROR` | Any other failure of the summary call (network, 5xx, bad JSON). | Retry; if it repeats, copy the report. |
| `MISSING_TRANSCRIPTION_KEY` | Audio provider is OpenAI Whisper but no OpenAI key is saved. | Add the OpenAI key, or switch the provider back to OpenRouter. |
| `MEDIA_NEEDS_PLAYBACK` | No whole media stream was captured (nothing at all, or only loose segments). tldw already tried to start the video muted for ~5 s. | Reload the page, press play, wait 2–3 s, retry. Keep the original tab open. |
| `MEDIA_NOT_CAPTURABLE` | A source was found but cannot be assembled: DASH-only stream, empty HLS playlist, or an unusable `master.json`. | Not fixable from the extension; try another page or player. |
| `MEDIA_PROTECTED` | The media server answered **401/403**. This is what encrypted or expired-token streams look like. | Replay the video to get a fresh signed URL, retry. DRM content is never bypassed. |
| `MEDIA_TOO_LARGE` | The source exceeds **1 GiB** (`MAX_MEDIA_BYTES`). | Use a shorter or lower-quality version. |
| `AUDIO_EXTRACTION_FAILED` | ffmpeg.wasm could not load or decode (no audio track, corrupt download, offscreen document unreachable). | Reload the extension (`chrome://extensions` ↻) and retry; check the offscreen console (see §6). |
| `TRANSCRIPTION_API_ERROR` | The transcription call failed, or returned only silence/empty text. | Retry; for a music-only video this is expected. |
| `TIMEOUT` | A phase exceeded its budget (§4). | Retry on a better connection, or use a shorter video. |
| `INTERRUPTED` | The browser restarted the background worker mid-job (a running job is never resumed). | Run the summary again. |
| `CANCELLED` | You pressed **Cancel**. Neutral, not a failure. | — |
| `UNKNOWN` | Anything unexpected. | Copy the report and open an issue. |

Defined but not normally shown to users: `NO_CAPTIONS_AVAILABLE` and `CAPTIONS_BLOCKED` (the cascade consumes them and moves to the next level), `NO_VIDEO_DETECTED`, `UNSUPPORTED_PROVIDER` and `QUOTA_EXCEEDED` (the list shows an empty state or “not supported” instead).

## 3 · The diagnostic report

**Settings → Diagnostic**: **Copy the report**, **Download the report** (`tldw-diagnostic-<date>.txt`), **Clear logs**. A **Copy report** link is also offered on every error row.

Everything is produced locally. Nothing is sent anywhere; you choose whether to paste it into an issue.

| Section | Contents |
|---|---|
| Extension / Build | Name, manifest version, build version + short commit sha + build date |
| Environment | Browser user agent |
| Settings | Every setting; anything named key/token/secret/password/credential shows **only “present: yes/no”** |
| Jobs | Per job: state, steps and their status; for errors the code, message and detail; for done jobs title, provider, transcript source, model — **never transcript or summary text** |
| Logs | The last 50 of up to 500 entries (about 256 KiB retained, oldest dropped first) from the worker, offscreen document, content scripts and popup |

Redaction (applied when a line is written **and again** when the report is built): OpenRouter/OpenAI/Google/GitHub/GitLab-style keys, `Bearer`/`Basic` credentials, `Cookie` headers, secret-named query parameters (`token`, `sig`, `key`, `hmac`…), signed-URL path segments, Drive file ids, IPv4 addresses. Media URLs are reduced to `host/<shape>` (for example `rr3---sn.googlevideo.com/videoplayback (1 seg)`), never logged in full. Video titles are included.

## 4 · Time budgets, progress, queue

| Phase | Limit |
|---|---|
| Captions | `timeoutSeconds` (default 15 min; stored setting, not shown in the popup) |
| Media download + extraction | Fails after **120 s without any progress**; overall cap = max(`timeoutSeconds`, 10 min) |
| Transcription | `timeoutSeconds` + 1 s per second of media, at most 4 h. Each OpenRouter chunk: 5 min per attempt, up to 4 attempts with backoff; a 429 `Retry-After` is honored up to 60 s |
| Summary | `timeoutSeconds` + a quarter of the media duration, at most 4 h |

The progress bar is weighted and never goes backwards:

| Path | Weights |
|---|---|
| Captions | captions 0→15 %, summary 15→100 % |
| Audio | download 0→30 %, audio extraction 30 %, transcription 30→85 %, summary 85→100 % |
| YouTube video URL | summary only, 0→100 % |

Phases with no measurable size (the model call, a download of unknown size) creep towards a cap instead of freezing, so the bar never claims to be finished early. An estimated time left appears only once the transcription rate is stable and the bar is past 10 %.

**Queue and cancel.** Audio jobs run **one at a time** (one offscreen document, one ffmpeg). A second video shows “Waiting (k videos ahead)…”; **Summarize all** registers every video at once and runs them in order. Starting a video that is already running or queued joins the existing job instead of paying twice. **Cancel** works on a running or queued job, takes effect at once, and frees the video to be started again. Closing the popup never stops a job.

## 5 · Google Drive and long videos

- Drive videos are captured from `googlevideo.com` / `*.c.drive.google.com` / `*.c.docs.google.com` `/videoplayback` byte ranges and downloaded in 8 MiB blocks.
- The source is held in memory: peak ≈ **2× the file size**, hence the 1 GiB limit (about 2 GiB peak). A 500 MB file peaks near 1 GB.
- Audio is extracted per window as mono 16 kHz MP3 at 64 kbps (8,000 bytes/s, 28.8 MB for one hour). With OpenRouter, an hour is sent as **5 sequential chunks of at most 12 min**; with Whisper, as 2 windows of at most 24 MiB with 5 s overlap.
- If a stream's total size is unknown, the duration is assumed to be 6 h and the loop stops at the first empty window. If the downloaded media is under 80 % of the page's duration, the summary is shown but **not cached**.
- Private Drive files only work while you are signed in to the right Google account in that browser profile.
- Capture buffers are bounded (60 loose segments, 30 manifests per tab) and forgotten when the tab navigates or closes.

Rough memory and request sizes for a given length: `node scripts/estimate-long-video.mjs`.

## 6 · Where to look

| Context | How to open it |
|---|---|
| Popup | Right-click the popup → **Inspect** |
| Service worker (jobs, capture) | `chrome://extensions` → tldw → **service worker** |
| Offscreen document (download, ffmpeg) | Same card → **offscreen.html** (listed only while an audio job runs) |
| Content script (detection) | The page's own DevTools console, frame selector for iframes |
| Network | The page's **Network** tab, filter `videoplayback`, `m3u8`, `mp4` to see what the player requests |

## 7 · Reporting a bug

Open an [issue](https://github.com/adrnbttr/tldw/issues) with: the diagnostic report, the page type (YouTube / Vimeo / Drive / native / which hosted player), the video duration, and what you expected. **Never paste an API key**, even though the report masks them. Security problems: see [`SECURITY.md`](../SECURITY.md).
