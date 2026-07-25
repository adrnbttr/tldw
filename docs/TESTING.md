# Testing & validation guide

A hands-on checklist to validate tldw in a real browser, phase by phase. It doubles
as the script for capturing the screenshots used in the README.

The unit suite (`npm test`) covers the pure logic. This guide covers what only a
real browser can confirm: detection on live pages, the network calls, the offscreen
audio pipeline, and the UI flows.

---

## 0 · Setup

```bash
./install.sh          # or: npm install && npm run build
```

Load `dist/` via `chrome://extensions` → **Developer mode** → **Load unpacked**
(see the [README](../README.md#install)).

**Keys** (popup → ⚙ Settings):

| Key | Needed for | Where |
|---|---|---|
| OpenRouter | every summary (Phases 1–4) | <https://openrouter.ai/keys> |
| Transcription (OpenAI) | the audio fallback only (Phase 3) | <https://platform.openai.com/api-keys> — this is the Whisper key |

> Tip: fund each provider with a small amount first. A single summary costs a
> fraction of a cent; a Whisper transcription is ~$0.006/min.

### Where to look when something fails

No failure is silent — every error shows a typed message. To see *why*, open the
right console:

| Context | How to open its DevTools |
|---|---|
| Popup UI | Right-click the popup → **Inspect** (this also keeps it open for screenshots) |
| Service worker (orchestration, media capture) | `chrome://extensions` → tldw → **service worker** |
| Offscreen document (ffmpeg + Whisper) | `chrome://extensions` → tldw → **Inspect views: offscreen.html** (only listed while a job runs) |
| Content script (detection) | The page's own DevTools console |
| Stored data | Service-worker console → `await chrome.storage.local.get()` |

To start from a clean slate: `chrome.storage.local.clear()` in the service-worker
console, then reload the extension.

---

## 1 · Phase 1 — YouTube captions (nominal path)

The most reliable path; validate this first.

1. Open a page with an **embedded YouTube video** (ideally inside your
   authenticated site; a public embed works too).
2. Start playback, open the tldw popup.
3. **Expect:** the video is listed with a `YouTube` badge, title, and duration.
4. Click **Résumer**.
5. **Expect** the steps to advance:
   `✓ Détection · ✓ Recherche des sous-titres · [–] Capture · [–] Transcription · ⟳ Génération`
   (the two audio steps are skipped when captions exist).
6. **Expect** a rendered summary matching the template: `# title`, *En bref*,
   *Points clés*, *Développement*, *Notions et termes techniques*, *À retenir*, with
   the method line **“Méthode : Sous-titres YouTube”**.
7. Click **Télécharger (.md)** → a `YYYY-MM-DD-<slug>.md` file downloads.
8. Click **Copier** → the Markdown is in your clipboard.

**Also check**
- Close the popup mid-processing, reopen it → the state is restored (the job runs in
  the service worker).
- A page with **no video** → “Aucune vidéo trouvée sur cette page.”
- No OpenRouter key set → “Clé OpenRouter manquante.”

📸 *Capture: the video list, the processing view, and the result view.*

---

## 2 · Phase 2 — Vimeo captions (level 1)

1. Open a page with an **embedded Vimeo video that has captions (CC)**.
2. Summarize it.
3. **Expect:** method line **“Méthode : Sous-titres Vimeo”**, same template.

**Fallthrough check (important):** open a Vimeo video **without** captions and with
**no transcription key** set.
- **Expect:** the captions step fails and, because the audio fallback isn't
  configured, you get a clear typed error — *“Cette vidéo n'a pas de sous-titres et
  la transcription audio n'est pas configurée…”*. This confirms the cascade drops
  cleanly instead of hanging.

---

## 3 · Phase 3 — Audio transcription fallback 🧪

The delicate path. It runs entirely in the offscreen document:
**resolve source → download → ffmpeg.wasm (mono MP3) → chunk → Whisper → merge.**

**Precondition:** a transcription (OpenAI) key is set, and the video is **DRM-free**
(generic download tools work on it).

1. Open a **Vimeo video without captions** and start playback.
2. Summarize it.
3. **Expect** the steps to reach the audio branch:
   `✓ Recherche des sous-titres (échec) → ⟳ Capture du flux média → ⟳ Transcription audio`
   with a live detail like *“Transcription 1/2 (0:00)…”*.
4. **Expect** a summary with method line **“Méthode : Transcription audio”** — and,
   critically, the **same template structure** as a caption-based summary. That
   equivalence is the acceptance criterion (spec §6).

### If it fails — diagnosing by symptom

Open the **offscreen** and **service-worker** consoles (table above) and match the
typed error:

| Error shown | Likely cause | What to check |
|---|---|---|
| `MEDIA_NOT_CAPTURABLE` | no media source found | Service-worker console: is `chrome.webRequest` recording media URLs? Does the Vimeo `config` expose a `progressive`/`hls` URL? |
| `MEDIA_PROTECTED` | 401/403 on the media, or encryption | The stream needs auth cookies (fetch uses `credentials: include`) or is DRM-protected — tldw does **not** bypass DRM by design. |
| `AUDIO_EXTRACTION_FAILED` | ffmpeg.wasm didn't load or run | Offscreen console: look for a CSP error (`wasm-unsafe-eval`) or a worker/blob error. Confirm `dist/ffmpeg/ffmpeg-core.wasm` shipped. |
| `TRANSCRIPTION_API_ERROR` | Whisper rejected the request | Network tab in the offscreen console: 401 (key), 413 (chunk too large), 400 (format). |
| `QUOTA_EXCEEDED` | rate limit / credits | The provider message + any `Retry-After` are surfaced verbatim. |
| `TIMEOUT` | exceeded the global limit | Long video — raise the timeout in Settings, or try a shorter clip first. |

> Start with a **short** video (2–5 min) to validate the pipeline before trying a
> long one. A short clip yields a single chunk and isolates the plumbing from the
> chunking/merge logic.

📸 *Capture: the processing view during transcription.*

---

## 4 · Phase 4 — Batch, history, templates, quotas

**Batch (F8)**
1. On a page with several videos, tick 2+ of them → **Résumer la sélection (n)**.
2. **Expect** a progress bar advancing `n/total` with the current title, then a
   results list (✓/✗ per video) and **“Télécharger tout … en un fichier .md”** — one
   document with the summaries separated by `---`.

**History (F9)**
1. Click 🕘 in the top bar.
2. **Expect** past summaries listed; click one → it reopens **without reprocessing**.
3. Summarize the *same* video again → it should return instantly from cache.

**Templates (F7)**
1. Settings → **Template de résumé** → `Compact` → Save.
2. Summarize → **Expect** only *En bref*, *Points clés*, *À retenir* (no
   *Développement* / glossary).

**Quota handling (§4)**
- With an exhausted/invalid key, trigger a summary → **Expect** the provider's
  message shown verbatim, plus a *“réessayez dans Ns”* hint when a `Retry-After`
  header is present.

---

## 4b · Languages & native video

**Interface language**
- Settings → **Interface language** → pick Español/Deutsch → the popup updates
  instantly (no reload). Reopen the popup → the choice persists.

**Summary language**
- Settings → **Summary language** → German → summarize → the summary content *and*
  the section headings (`## Kurz gesagt`, …) come out in German.

**Native `<video>` (any site)**
- Open a page with a plain HTML5 `<video>` on a non-YouTube/Vimeo site (DRM-free),
  with a transcription key set.
- **Expect** it to be listed and summarizable: no caption step, straight to the
  audio fallback via the captured/native media URL.

## 5 · Acceptance criteria (spec §6)

- [ ] Detects YouTube and Vimeo videos embedded in an authenticated page
- [ ] Processing continues when the popup is closed
- [ ] A caption-based summary and a transcription-based summary share the **same**
      structure
- [ ] Every error shows an explicit cause and a possible action
- [ ] API keys are sent only to the provider concerned (check the Network tab: calls
      go to `openrouter.ai` and `api.openai.com` only)
- [ ] Temp files are cleaned up after processing, including on error (offscreen
      console shows no leftover FS entries)
- [ ] The summary is downloadable as Markdown

---

## 6 · Screenshots for the README

Capturing a popup: right-click it → **Inspect** to keep it open, then use your OS
screenshot tool on the popup window (macOS: <kbd>⌘⇧4</kbd> then Space to grab the
window).

Save PNGs to `.github/assets/screenshots/` and reference them from the
[Preview](../README.md#preview) section:

| File | Shot |
|---|---|
| `list.png` | Video list with a couple of detected videos |
| `processing.png` | Processing view mid-run |
| `result.png` | Rendered summary with the action buttons |
| `settings.png` | Settings screen (blur your keys) |

---

## 7 · Reporting

Found a bug? Open an [issue](https://github.com/adrnbttr/tldw/issues) with the typed
error code, the provider (YouTube/Vimeo), and the relevant console output — **never
paste your API keys**.
