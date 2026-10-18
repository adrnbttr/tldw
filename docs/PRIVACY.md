# Privacy

tldw has no server. Nothing you do with it is sent to the author or to any service we
operate, because there is none. No analytics, no telemetry, no tracking, no proxy in between.

The only parties that see anything are the ones you choose by adding a key (OpenRouter,
optionally OpenAI) and the video sites you already visit.

## What is stored on your machine

| What | Where | Lifetime |
|---|---|---|
| API keys (OpenRouter, optional OpenAI) and preferences | `chrome.storage.local` (`settings`) | Until you remove the extension. Stored as-is, not encrypted, like any extension setting. |
| Summary history (default: last 50) | `chrome.storage.local` (`history`) | Until trimmed or the extension is removed. Holds the summaries, **not** transcripts or media. |
| Activity log | `chrome.storage.local` (`tldw.logs`) | Rolling: last 500 entries, about 256 KiB, oldest dropped first. **Clear logs** in Settings erases it. |
| Running and finished jobs, detected videos per tab, captured media URLs (may be signed), "Summarize all" selection | `chrome.storage.session` | RAM only, cleared when the browser closes. Not readable by web pages or content scripts. |
| Audio and video downloaded for transcription | Memory of the extension's offscreen document | Released at the end of the job (also on error or cancel). Never written to disk by tldw. |

The activity log records what the extension did (job steps, errors, timings). Before a line is
written, secrets are masked (API keys, bearer tokens, cookies, secret query parameters,
signed-URL segments, IP addresses), and media URLs are reduced to host plus a coarse path shape.
It never leaves your machine on its own: the **diagnostic report** (Settings → Diagnostic) is
built locally, and you decide whether to copy or download it. It shows API keys only as
“present: yes/no” and never includes transcript or summary text. See
[`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md#3--the-diagnostic-report).

## What leaves your machine, and to whom

| Data | Sent to | When |
|---|---|---|
| Transcript text and video title | **OpenRouter**, with your key | Each time a summary is generated (long transcripts in several calls) |
| Audio of the video (mono MP3 chunks) | **OpenRouter** (Gemini), with your key — or **OpenAI** (Whisper), with your OpenAI key, if you chose it | Audio path only |
| YouTube watch URL | **OpenRouter**, routed to Google AI Studio (Gemini) | Only for a YouTube video whose captions are unavailable |
| Your API key | Only the provider it belongs to | Each request to that provider |
| Requests for captions, video metadata and media files | The video's own site (YouTube, Vimeo, the host serving the video file), **with your browser session cookies** where the site needs them | Detection metadata (public oEmbed: video id only), caption extraction, and the audio download |

Those requests are the same ones your browser makes when you watch the video. They carry no
tldw identifier. OpenRouter and OpenAI handle data under their own policies and your own account
settings; check those if you summarize sensitive content.

Nothing is sent anywhere else.

## What tldw never does

- It never sends your keys to anyone but the matching provider.
- It never reads the inside of a cross-origin iframe from outside: only the iframe's URL is read
  to identify the video. (A content script also runs *inside* the player frame itself to find its
  `<video>`; it reports only the video's address, title and duration.)
- It never bypasses DRM. Encrypted media fails with an error instead.
- It never uploads your history, settings or logs.

## Permissions, in plain words

| Permission | Why |
|---|---|
| `<all_urls>` host access, content script in all frames | Videos can sit in an iframe on any site you use; detection and capture must run there |
| `webRequest` | Observe (not block or modify) the page's media requests to find the video stream |
| `activeTab`, `scripting` | Re-run detection on a tab that was open before the extension was installed |
| `storage` | The data above |
| `downloads` | Save PDF / Word exports and the diagnostic report |
| `offscreen` | A hidden page that runs the audio tooling (ffmpeg.wasm), which a service worker can not |

## Your responsibility

Extracting content behind authentication may be governed by a site's terms of use. Confirming
that your usage is permitted is your responsibility. tldw is intended for personal use on content
you legitimately have access to.

A short public version of this policy is published at <https://www.adrienbouttier.com/tldw/>
(source: [`index.html`](./index.html)).
