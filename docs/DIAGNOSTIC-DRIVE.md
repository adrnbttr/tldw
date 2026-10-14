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
