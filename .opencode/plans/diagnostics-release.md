---
status: todo
---
# Plan: Logs de diagnostic exportables + build/test/publication de l'extension

Objectif : (1) savoir comment builder et charger l'extension pour tester, (2) qu'en cas d'erreur
l'utilisateur obtienne en 1 clic un **rapport de diagnostic** (logs de tous les contextes :
service worker, offscreen, content, popup + état des jobs + version + réglages sans clés) à
coller dans la conversation, (3) pouvoir publier une version proprement.

Constats sur l'existant (explore) :
- Les `console.*` sont dispersés (offscreen, ffmpeg) et éphémères : le SW est tué après ~30 s
  d'inactivité, l'offscreen disparaît à la fin du job → les logs sont perdus (cf. `docs/DIAGNOSTIC-DRIVE.md`
  qui demande 7 infos à la main).
- Les erreurs finales du job sont capturées dans `runJob` (`src/background/orchestrator.ts`) mais
  sans stack ni contexte, et ne sont jamais écrites nulle part.
- `zip` n'est PAS installé sur ce poste → `npm run package` et `npm run share` échouent
  (`scripts/package.mjs`, `scripts/share.mjs` appellent `zip`). `python3` et `gh` sont présents.
- Build de test : `npm install && npm run build` → charger `dist/` (chrome://extensions → Mode
  développeur → Charger l'extension non empaquetée), puis ↻ reload après chaque rebuild.
- Version actuelle `0.2.0` (tag `v0.2.0` existant), `CHANGELOG.md` a une section `[Unreleased]`.
- `package-lock.json` est modifié dans le working tree (hors périmètre : ne pas l'embarquer dans
  un commit sans vérification).

Design retenu :
- Module `src/shared/logger.ts` : `log.debug/info/warn/error(source, message, data?)`, redaction
  des secrets (clés `sk-…`, `Bearer …`, champs `*Key`, query `key=`), troncature des gros
  payloads, buffer circulaire (~500 entrées) persisté dans `chrome.storage.local['tldw.logs']`
  (survit au redémarrage du SW). Le SW est l'unique écrivain : offscreen/content/popup envoient
  un message `LOG` (l'offscreen n'a pas accès à `chrome.storage`).
- Rapport = texte/JSON : version, build (sha git), UA, réglages SANS clés, snapshot des jobs, derniers
  logs. Accessible via Réglages → « Diagnostic » : **Copier** / **Télécharger** / **Effacer**.
- Aucune donnée n'est envoyée nulle part (cohérent avec `docs/PRIVACY.md`) ; le rapport est
  généré localement et l'utilisateur le colle lui-même.

## Lot 1 — Noyau de logging (logger, redaction, persistance)
- [x] 1.1 Créer `src/shared/logger.ts` (+ `logger.test.ts`) : types `LogEntry {t, level, source: 'sw'|'offscreen'|'content'|'popup', msg, data?}`, `redact()` (clés API, Bearer, `key=` en query, champs `*Key`, `Authorization`), troncature des chaînes > 2 Ko, buffer circulaire pur de 500 entrées, `createLogger(sink)`. Pur et sans dépendance `chrome` (storage injectable, comme `JobStore` dans `src/background/job-store.ts`) [implementer] — recette : `npx vitest run src/shared/logger.test.ts` (cas : redaction `sk-or-v1-abc`, `Bearer xxx`, objet avec `openRouterKey`, dépassement 500 entrées, troncature) puis `npx tsc --noEmit`
- [x] 1.2 Créer l'adaptateur de persistance `src/background/log-store.ts` (+ test) sur `chrome.storage.local['tldw.logs']` : `append`, `readAll`, `clear`, écritures groupées (debounce ~500 ms) pour éviter de saturer le storage ; exclure `tldw.logs` de `historyLimit`/`storage` existant [implementer] — recette : `npx vitest run src/background/log-store.test.ts` (store en mémoire injecté) puis `npx tsc --noEmit`
- [x] 1.3 Ajouter le message `{ type: 'LOG'; entry }` (contextes → SW) et `GET_LOGS` / `CLEAR_LOGS` (popup → SW) dans `src/types/messages.ts` ; brancher le sink dans `src/background/index.ts` (le SW écrit directement, les autres contextes passent par `chrome.runtime.sendMessage`, échec silencieux) ; fournir `src/shared/logger-client.ts` pour offscreen/content/popup [implementer] — recette : `npx tsc --noEmit && npm run lint && npm test`

## Lot 2 — Instrumentation des points critiques
- [x] 2.1 Orchestrator : logger chaque transition d'étape (`setStep`), le démarrage/fin de job (id, provider, URL sans query sensible, durée), et l'erreur finale avec `code`, `providerMessage`, `err.stack` ; logger `restoreJobs`/`markInterrupted` (jobs INTERRUPTED) dans `src/background/orchestrator.ts` [implementer] — recette : `npm test && npx tsc --noEmit` ; test unitaire ajouté vérifiant qu'une erreur de job produit une entrée `error` avec le code
- [x] 2.2 Service worker + capture média : handlers globaux `self.addEventListener('error' | 'unhandledrejection')` dans `src/background/index.ts`, et logs dans `src/background/media-capture.ts`, `enrich.ts`, `page-fetch.ts` (nb de sources capturées, hôtes, statuts HTTP — jamais d'URL signées complètes : garder hôte + chemin) [implementer] — recette : `npm test && npx tsc --noEmit && npm run lint`
- [x] 2.3 Offscreen + transcription : remplacer les `console.*` de `src/offscreen/index.ts` (lignes ~94 et ~236) et `src/transcription/audio.ts` (~119, ~129) par le logger client (en conservant l'écho console) ; logger tailles téléchargées, plages, durée des phases ffmpeg, statuts HTTP du fournisseur de transcription [implementer] — recette : `npm test && npx tsc --noEmit && npm run lint`
- [x] 2.4 Summarizer + content + popup : logs des appels OpenRouter dans `src/summarizer/openrouter.ts` / `src/summarizer/index.ts` (modèle, statut, taille de réponse, retries — jamais le header Authorization ni le corps de la requête), détection dans `src/content/index.ts` (nb de vidéos, providers), erreurs d'UI dans `src/popup/main.tsx` (`window.onerror`) [implementer] — recette : `npm test && npx tsc --noEmit && npm run lint`

## Lot 3 — Rapport de diagnostic dans l'UI (copier / télécharger / effacer)
- [x] 3.1 Injecter les infos de build au build (`__TLDW_BUILD__` = version + sha git court + date) via `define` dans `vite.config.ts`, déclaration de type, et module pur `src/shared/diagnostics.ts` (+ test) : `buildReport({manifest, build, userAgent, settings, jobs, logs})` → texte Markdown avec réglages **sans** `openRouterKey`/`transcriptionKey` (afficher seulement « présente: oui/non ») [implementer] — recette : `npx vitest run src/shared/diagnostics.test.ts` (le rapport ne contient jamais la clé fournie en fixture) puis `npx tsc --noEmit`
- [x] 3.2 Handler SW `GET_LOGS`/`CLEAR_LOGS`/`GET_DIAGNOSTICS` assemblant le rapport (storage settings + snapshot jobs + logs) dans `src/background/index.ts` [implementer] — recette : `npm test && npx tsc --noEmit`
- [x] 3.3 Section « Diagnostic » dans `src/popup/components/SettingsView.tsx` : boutons Copier le rapport (clipboard), Télécharger (`tldw-diagnostic-<date>.txt` via `chrome.downloads` ou blob), Effacer les logs ; bouton « Copier le rapport » aussi sur l'écran d'erreur (`ResultView`/vue d'erreur) ; textes dans les 4 catalogues `src/i18n/{en,fr,es,de}.ts` + `types.ts` [implementer] — recette : `npx tsc --noEmit && npm run lint && npm test` (le test i18n existant `src/i18n/i18n.test.ts` valide la parité des clés)
- [ ] 3.4 Vérification visuelle : builder (`npm run build`), charger `dist/` dans Chromium Playwright, ouvrir `chrome-extension://<id>/src/popup/index.html`, vérifier la section Diagnostic (thèmes clair/sombre, 4 langues) et qu'un rapport copié ne contient aucune clé [visual] — recette : captures + liste d'écarts ; `grep -c "sk-or" <rapport>` doit valoir 0

## Lot 4 — Build, test avec l'extension et publication d'une version
- [ ] 4.1 Rendre l'empaquetage indépendant de `zip` : remplacer l'appel `zip` dans `scripts/package.mjs` et `scripts/share.mjs` par une fonction Node commune `scripts/lib/zip.mjs` (dépendance dev légère type `fflate`, ou `python3 -m zipfile -c`) ; exclure `*.map` [implementer] — recette : `npm run package && python3 -m zipfile -l tldw-v$(node -p "require('./package.json').version").zip | head` et `npm run share:lite` puis `python3 -m zipfile -l tldw-share-lite-v*.zip | head` (le zip contient `manifest.json` à la racine pour `package`) ; supprimer les zips générés ensuite
- [ ] 4.2 Ajouter `npm run build:test` (build + affichage du chemin absolu de `dist/`, version, sha, rappel « ↻ reload sur chrome://extensions ») et `npm run release:check` (lint + test + build + vérif que `package.json` version == `manifest` version == entrée datée du `CHANGELOG.md`) via `scripts/release-check.mjs` [implementer] — recette : `npm run build:test` puis `npm run release:check` (échoue volontairement si CHANGELOG sans section de version, vérifié à la main)
- [ ] 4.3 Documenter dans `docs/RELEASING.md` (+ lien depuis `README.md` et `docs/TESTING.md`, section « Where to look when something fails » complétée avec « Réglages → Diagnostic → Copier le rapport ») : build de test, rechargement, collecte du rapport, procédure de release (bump version dans `package.json`, CHANGELOG `[Unreleased]` → `[0.3.0] - date`, `npm run release:check`, commit, `git tag v0.3.0`, `git push --tags`, `gh release create v0.3.0 tldw-v0.3.0.zip --notes-file …`) ; mettre à jour `docs/DIAGNOSTIC-DRIVE.md` pour remplacer les étapes manuelles 3-4 par le rapport [chore] — recette : `npm run lint` (prettier sur les .md) 
- [ ] 4.4 Revue critique finale : sécurité des logs (aucune clé/URL signée/contenu de transcript dans les logs ou le rapport), coût stockage (`chrome.storage.local` quota), impact perfs du debounce [challenger] — recette : rapport de revue ; corrections éventuelles reportées en tâches
- [ ] 4.5 Publication : bump `0.2.0` → `0.3.0` (`package.json` + `package-lock.json` propre, vérifier d'abord le diff déjà présent), CHANGELOG, `npm run release:check`, `npm run package`, puis (après accord explicite de l'utilisateur) commit, tag `v0.3.0`, push et `gh release create` avec le zip [implementer] — recette : `npm run release:check && gh release view v0.3.0 --json assets -q '.assets[].name'` ; archiver ce plan dans `.opencode/plans/done/` (status: done) et commit
