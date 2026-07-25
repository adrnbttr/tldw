# Privacy

tldw is designed so that your data never touches a server we control — because
there is no server we control.

## What is stored, and where

Everything lives in `chrome.storage.local`, on your machine only:

- **API keys** (OpenRouter, transcription provider)
- **Preferences** (model, language, detail level, template)
- **Summary history** (up to a configurable limit, default 50)

## Where your data goes

| Data | Sent to | When |
|---|---|---|
| Video transcript text | OpenRouter (your key) | When you generate a summary |
| Audio segments | Your transcription provider (your key) | Audio fallback only (Phase 3) |
| API keys | Only the provider they belong to | On each request to that provider |

Nothing is sent anywhere else. There is no telemetry, no analytics, no third-party
tracking, and no proxy in between.

## What tldw never does

- It never transmits your keys to any party other than the matching provider.
- It never accesses the contents of cross-origin iframes — only the iframe `src`
  is read to identify the video.
- It never attempts to bypass DRM. Encrypted media raises a `MEDIA_PROTECTED`
  error instead.

## Your responsibility

Extracting content behind authentication may be governed by a site's terms of use.
Confirming that your usage is permitted is your responsibility. tldw is intended for
personal use on content you legitimately have access to.
