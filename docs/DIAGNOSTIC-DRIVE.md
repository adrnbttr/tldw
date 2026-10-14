# Diagnostic — résumé bloqué sur une vidéo Google Drive (1 h)

Projet : extension Chrome MV3 « tldw » qui résume des vidéos. On enquête sur une
vidéo d'une heure hébergée sur Google Drive dont le résumé « tourne » sans jamais
rendre de résultat.

## Installation

Constats sur ce poste :

- Node v20.20.2 / npm 10.8.2 (`.nvmrc` = 20) : OK.
- `npm ci --dry-run` : OK.
- `dist/` v0.2.0 construit le 29/09/2026 à 20:01, plus récent que les sources
  (dernière modification 28/09 à 21:51), et contient `dist/ffmpeg/ffmpeg-core.wasm`
  (32 Mo) → build à jour, pas de rebuild nécessaire.
- `ffmpeg` / `yt-dlp` système absents : non requis, `ffmpeg.wasm` est embarqué.
- Tests 77/77 verts, `tsc --noEmit` : OK.
- Aucun navigateur Chromium installé dans le PATH ; seul `google-chrome-for-testing`
  (Playwright, `~/.cache/ms-playwright/chromium-1247/1248`) est présent, sans profil
  → aucune trace de l'extension chargée sur CE poste.

**Build installé et à jour, mais l'extension n'est chargée dans aucun navigateur sur ce poste** (donc la panne a eu lieu sur un autre navigateur/machine, ou il faut la charger via chrome://extensions → Mode développeur → Charger l'extension non empaquetée → dossier `dist/`).

## À fournir par l'utilisateur

1. **Forme du lien Drive** : page `drive.google.com/file/d/ID/view`, ou iframe
   `/preview` intégrée dans une autre page (LMS) ? (URL avec l'ID masqué.)
2. **Erreur ou blocage** : code d'erreur et détail affichés dans le popup (champ
   `detail`, ex. `sample=… kinds=…`) ; ou, si ça « tourne » sans fin : quelle étape
   reste active (`captions` / `audio_capture` / `transcription` / `summarize`), le
   texte de détail, et depuis combien de temps.
3. **Console du service worker** : `chrome://extensions` → carte tldw → lien
   « service worker » → onglet Console : copier les erreurs.
4. **Console de l'offscreen document** : `chrome://extensions` → « Inspecter les
   vues » → `offscreen.html` : chercher les lignes `[tldw] captured sources` et
   `[tldw] audio fallback failed`.
5. **Onglet Network** des DevTools de la page Drive, filtre `videoplayback` : nombre
   de requêtes, domaine (`googlevideo.com`), présence de `range=`, `mime=`.
6. **Réglages** : fournisseur de transcription (OpenRouter / Whisper), modèle audio,
   modèle de résumé, délai (`timeoutSeconds`, défaut 15 min).
7. **Si possible** : durée exacte de la vidéo et taille du fichier Drive.

## Coût d'1 h

Chiffrage du traitement d'une vidéo d'une heure, produit par
`node scripts/estimate-long-video.mjs` (Node 20, ESM, sans dépendance). Le script
recopie — un `.mjs` ne peut pas importer du TS — `planChunks`
(`src/transcription/chunker.ts`) et `AUDIO_BYTES_PER_SECOND`
(`src/transcription/audio.ts`, MP3 mono 16 kHz à 64 kbps).

Sortie du script :

```text
durée=3600 s
audio total : 28 800 000 o (28,8 Mo) — MP3 mono 16 kHz à 64 kbps
chunks=2
  chunk 0 : 0 s → 3 145 s (3 145 s) = 25 160 000 o (25,16 Mo)
  chunk 1 : 3 140 s → 3 600 s (460 s) = 3 680 000 o (3,68 Mo)
taille base64 par requête (×4/3) :
  chunk 0 : 33 546 667 o (33,55 Mo)
  chunk 1 : 4 906 667 o (4,91 Mo)

RAM pic estimée (majorant ≈ 3 × vidéo + audio) :
  vidéo 500 Mo : 1 528,8 Mo (≈ 1,53 Go)
  vidéo 1 000 Mo : 3 028,8 Mo (≈ 3,03 Go)
```

Hypothèses :

- audio : MP3 mono 16 kHz à 64 kbps → 8 000 o/s (`AUDIO_BYTES_PER_SECOND`,
  `src/transcription/audio.ts`) ; 1 h → 28,8 Mo.
- découpage : `planChunks` (`src/transcription/chunker.ts`), morceau ≤ 24 Mio,
  recouvrement 5 s (défaut du chemin Whisper ; le chemin OpenRouter passe
  `overlapSeconds: 0` — même résultat ici : 2 morceaux).
- base64 : taille transmise ≈ 4/3 × taille binaire ; la limite Whisper de 25 Mo
  porte sur le binaire.
- RAM pic = téléchargement de la vidéo en mémoire (×1) + concat des segments
  (copie ×2, cf. `concat()` dans `src/offscreen/index.ts`) + entrée écrite dans
  le MEMFS de ffmpeg.wasm (×~1, cf. `writeFile()` dans
  `src/transcription/audio.ts`) + sortie audio MP3 — majorant, les phases ne
  sont pas simultanées.
- non compté : `ffmpeg-core.wasm` (~32 Mo), heap JS/wasm, base64 des requêtes,
  réponse du service.
- 1 Mo = 10^6 octets ; tailles de source façon affichage Drive (décimal).

## Synthèse de la revue critique (lot 2)

| Hyp. | Verdict | Preuve |
| ---- | ------- | ------ |
| H1 détection iframe | confirmée | `manifest.config.ts:46` (`all_frames: false`) ; `detect.ts` ne connaît que YouTube/Vimeo ; `it.fails` dans `detect.test.ts` |
| H2 capture `videoplayback` | confirmée (verrou principal) | `media.ts:16-28` → `unknown` ; `media-capture.ts:26` rejette `unknown` ; `it.fails` dans `media.test.ts` |
| H3 mémoire | confirmée (pas encore atteinte) | `offscreen/index.ts:201-202` (`fetchBytes`), `concat()`, `audio.ts:62` ; pic 1,5-3 Go |
| H4 timeout global 15 min | confirmée | `transcription/index.ts:196-199` |
| H5 état du job en RAM du SW | confirmée (à tester : durée de vie réelle du SW) | `orchestrator.ts:28-31` |
| H6 morceaux 33 Mo sans retry/`max_tokens` | confirmée (à tester : limite de taille de requête OpenRouter) | `chunker.ts:35`, `openrouter-audio.ts:56-68` |

Le job « tourne » parce qu'aucune source média n'est jamais trouvée (H1 + H2, chacun suffisant).

Ordre de correction recommandé : H2 → H1 → H4 → H3 (refuser > ~600 Mo avec un
message clair) → H6 → H5.

Angles morts à traiter dès le lot 3 :

- URLs signées `videoplayback` avec `expire=` : re-capture si expirées (sinon 403 → `MEDIA_PROTECTED`).
- Cookies Drive non transmis depuis l'origine `chrome-extension://` : seules les URLs signées capturées sont fiables.
- Buffer `MAX_SEGMENTS_PER_TAB = 60` (`media-capture.ts:15`) : une vidéo d'1 h en plages `range=` évince les premières plages ; le player ne précharge pas 1 h.
- CORS de `googlevideo.com` depuis l'offscreen : à vérifier (passage par le background ?).
- Fichiers Drive non publics : prévoir un message d'erreur dédié.
- Durée inconnue (`video.duration` dans l'iframe) : `estimateDuration` (taille vidéo / bitrate audio) la surestime d'un facteur ~10.
- Ajouter des tests sur l'assemblage par `range`, l'expiration et l'éviction du buffer avant d'implémenter.
