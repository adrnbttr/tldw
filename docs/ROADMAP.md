# Roadmap

Development started from the phasing in the [functional spec](./SPEC.md) (§5). Everything
below is **not done yet**; shipped work is recorded in the [changelog](../CHANGELOG.md).

## Shipped, in one paragraph

The four original phases (detection, YouTube and Vimeo captions, the audio-transcription
fallback, batch / history / quota handling) and what came after: Google Drive and 1-hour videos
(windowed audio, range downloads), detection in every frame (cross-origin player iframes,
open shadow DOM, click-to-load facades, Wistia / Loom / Dailymotion / Brightcove / JW Player /
Kaltura / Panopto / Streamable / Twitch players), Gemini watching a YouTube URL when captions
are blocked, a single OpenRouter key for everything, a queue with cancel and a weighted progress
bar, jobs that survive a service-worker restart, PDF and Word export, four interface languages,
and the local diagnostic report.

## Next

| Item | Why | Notes |
|---|---|---|
| **Timestamps and clickable chapters** | Jump to the moment a section comes from | Captions already carry segment times; the OpenRouter audio path returns plain text per chunk, so chunk boundaries (≤ 12 min) are the only timing it has today. Needs timed output from the model, or Whisper. |
| **Transcript cache (IndexedDB)** | Only the summary is cached (keyed by video, output language and summary model): a summary in another language or with another model — or a regeneration — re-downloads and re-transcribes the video | Key by video key; size-bound and clearable; mention in [`PRIVACY.md`](./PRIVACY.md). |
| **Cheaper YouTube path** | Without captions, Gemini ingests the whole video (~300 tokens/s, ≈ 1M tokens for an hour) | Use InnerTube transcript retrieval first and keep Gemini-watching as the last resort. |
| **Native `<track>` captions before audio** | A `<video>` that already has WebVTT / `<track>` captions needs no transcription | Read `textTracks` in the content script; saves cost and time. |
| **Key validation and OpenRouter OAuth (PKCE) onboarding** | Today the user pastes a key (format-checked only, `sk-or-…`) and learns it is wrong at the first summary | Validate with a cheap call on save; offer "Connect OpenRouter" via PKCE. |
| **Closed shadow roots** | Players inside closed shadow DOM are invisible to the content script | Use `chrome.dom.openOrClosedShadowRoot` (extension-only API). |
| **Live Drive host verification** | The Drive stream hosts (`*.googlevideo.com`, `*.c.drive.google.com`, `*.c.docs.google.com`) are matched from observation and unit tests | Confirm against real Drive playback and update `MEDIA_URL_PATTERNS` / `media.ts` if Google changed hosts. |

## Later / ideas

- Caption adapters for hosted players (Wistia, Loom, Dailymotion…) — detection is done, text still comes from audio; the `Adapter` interface makes these additive.
- DASH (`.mpd`) assembly — such streams currently fail with `MEDIA_NOT_CAPTURABLE`.
- Real-extension screenshots in the README (see [`SCREENSHOTS.md`](./SCREENSHOTS.md)).
- Firefox MV3 support.

## Open questions

Tracked in the [spec](./SPEC.md) §7: transcription provider (Whisper vs Deepgram) and Firefox support.
