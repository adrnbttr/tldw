# Chrome Web Store — listing copy

Paste these fields into the Web Store developer dashboard. Keep this file in sync
with `package.json` and the manifest.

## Product name

```
tldw — Video Summaries
```

## Summary (max 132 characters)

```
Turn embedded YouTube & Vimeo videos into structured Markdown summaries. Your own API keys, no backend, nothing tracked.
```

## Category

Productivity

## Language

English (UI strings are currently French; set primary language accordingly if you
localize the listing).

## Detailed description

```
tldw turns the videos embedded on a page into a clean, structured summary you can
read in a minute and download as Markdown.

HOW IT WORKS
1. Open a page with a YouTube or Vimeo video.
2. Click tldw — it lists the videos it detected.
3. Hit "Summarize". tldw gets the spoken content (captions first, an audio
   transcription fallback when there are none) and generates a structured summary.
4. Read it, then download as .md or copy it.

WHY IT'S DIFFERENT
• Consistent output — the model returns structured data and the layout is rendered
  from a versioned template, so every summary reads the same.
• Works behind a login — extraction runs in your tab's own session.
• Bring your own model — Claude Sonnet or Gemini Flash via OpenRouter.
• Batch mode, a browsable history, and selectable templates.

PRIVACY
No backend, no analytics, no tracking. Your API keys stay in local storage and are
only ever sent to the provider they belong to (OpenRouter for summaries, your
transcription provider for the audio fallback).

YOU NEED
• An OpenRouter API key (for summaries).
• Optionally, a transcription API key (only for the audio fallback).

Extracting content behind a login may be governed by a site's terms of use;
confirming your usage is permitted is your responsibility. tldw never bypasses DRM.
```

## Single purpose description

```
tldw has one purpose: to generate a downloadable text summary of a video embedded
on the page the user is viewing.
```

## Permission justifications

Copy each justification into the matching field at submission time.

| Permission | Justification |
|---|---|
| `storage` | Store the user's API keys, preferences, and a local history of generated summaries. |
| `activeTab` | Read the current tab, on user action, to list the videos embedded on it. |
| `scripting` | Run the detection content script that finds embedded players in the page. |
| `downloads` | Save the generated summary as a `.md` file when the user clicks Download. |
| `webRequest` | Observe (never block) media request URLs so the audio fallback can locate the stream when a video has no captions. |
| `offscreen` | Run ffmpeg.wasm in an offscreen document to extract the audio track; the service worker has no DOM. |
| `host_permissions: <all_urls>` | Embedded players and their media can be served from any site the user legitimately visits; the extension must read the page and fetch captions/media there. All calls stay in the browser. |

## Data usage disclosures

- **Does the extension collect user data?** No data is collected by the developer.
- **Data sent to third parties:** the video transcript is sent to OpenRouter (the
  user's key) to produce the summary; audio is sent to the user's transcription
  provider only when the fallback runs. Both are the user's own accounts.
- **No** selling of data, **no** analytics, **no** creditworthiness/lending use.

## Privacy policy URL

```
https://www.adrienbouttier.com/tldw/
```
