# Spécifications fonctionnelles — Extension de résumé automatique de vidéos

**Version :** 1.0 (cadrage d'origine)
**Statut :** Implémenté et dépassé sur plusieurs points. Ce document garde la spécification initiale ;
les passages marqués **[Implémentation]** décrivent ce que fait le code aujourd'hui. Pour l'état
courant : [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md),
[`ROADMAP.md`](./ROADMAP.md).
**Destinataire :** Agent de développement

---

## 1. Contexte et objectif

### 1.1 Besoin

L'utilisateur consulte des contenus vidéo pédagogiques sur des sites nécessitant une authentification (cas identifié : plateforme de préparation orthophoniste). Les vidéos sont hébergées chez des tiers (YouTube, Vimeo) et embarquées dans les pages du site.

Regarder chaque vidéo intégralement est coûteux en temps. L'objectif est de produire un résumé textuel structuré de chaque vidéo, téléchargeable, avec un formalisme identique d'une vidéo à l'autre.

### 1.2 Objectif produit

Une extension de navigateur qui :

1. Détecte les vidéos présentes sur la page consultée
2. Récupère le contenu parlé de la vidéo (sous-titres ou transcription)
3. Génère un résumé structuré via LLM
4. Permet de télécharger ce résumé au format Markdown

### 1.3 Contraintes structurantes

| Contrainte | Implication |
|---|---|
| Contenu derrière authentification | L'extraction doit s'exécuter dans le contexte de l'onglet (cookies de session hérités) |
| Hébergeurs multiples (YouTube, Vimeo) | Architecture à adaptateurs |
| Vimeo sans piste de sous-titres (constaté) | Fallback transcription audio obligatoire |
| Paiement à l'usage souhaité | Clés API utilisateur, pas d'abonnement |
| Formalisme de sortie constant | Template de prompt versionné + sortie structurée |

### 1.4 Point de vigilance juridique

L'extraction de contenu situé derrière une authentification est généralement encadrée par les conditions d'utilisation du site. **Cette vérification incombe à l'utilisateur avant mise en production.** L'extension est conçue pour un usage personnel sur des contenus auxquels l'utilisateur a légitimement accès.

---

## 2. Architecture générale

### 2.1 Principe : cascade best-effort

L'extension tente d'obtenir le texte de la vidéo par niveaux successifs, en descendant d'un cran à chaque échec.

```
Niveau 1 — Piste de sous-titres
  ├── YouTube : sous-titres manuels ou automatiques
  └── Vimeo   : texttrack si présent
        │
        ├── SUCCÈS → texte brut
        └── ÉCHEC ↓

Niveau 2 — Extraction audio + transcription
  ├── Capture des segments média
  ├── Extraction de la piste audio
  └── Envoi au service de transcription (Gemini via OpenRouter par défaut, Whisper en option)
        │
        ├── SUCCÈS → texte brut
        └── ÉCHEC ↓

Niveau 3 — Échec explicite
  └── Message utilisateur détaillant la cause
```

**[Implémentation]** Pour YouTube, un échec du niveau 1 (sous-titres absents ou bloqués) ne descend pas au niveau 2 : Gemini « regarde » l'URL de la vidéo via OpenRouter (modèle `google/gemini-3.1-flash-lite`, source `youtube_video`). Pour les autres hébergeurs, le niveau 2 est le fallback audio. Un `<video>` natif, un fichier Google Drive ou un player hébergé n'a pas d'adaptateur de sous-titres et démarre au niveau 2.

**Règle d'architecture :** chaque niveau produit le même artefact — un objet `Transcript` normalisé. Le module de résumé est agnostique de la provenance du texte. C'est ce qui garantit un formalisme de sortie identique quel que soit le chemin emprunté.

### 2.2 Composants

| Composant | Rôle | Contexte d'exécution |
|---|---|---|
| `content-script` | Détection des vidéos dans le DOM | Page web |
| `background` (service worker) | Orchestration, interception réseau, appels API | Extension |
| `popup` | Interface utilisateur | Extension |
| `adapters/` | Extraction par hébergeur | Background |
| `transcription/` | Fallback audio → texte (le travail lourd tourne dans un document offscreen : ffmpeg.wasm + appels API) | Background + offscreen |
| `summarizer/` | Génération du résumé | Background |
| `storage/` | Clés API, préférences, historique | Extension |

### 2.3 Stack cible

- **Manifest V3** (Chrome / Edge ; compatibilité Firefox à évaluer en option)
- Pas de framework imposé pour le popup ; du vanilla JS ou un framework léger convient (**[Implémentation]** Preact + TypeScript strict)
- Aucun backend : tous les appels API partent du navigateur avec les clés de l'utilisateur

---

## 3. Spécifications fonctionnelles détaillées

### 3.1 F1 — Détection des vidéos

**Déclenchement :** au chargement de la page et à chaque mutation du DOM.

**Comportement :**

Le content script recherche :

- Les éléments `<video>` natifs
- Les `<iframe>` dont le `src` correspond à un hébergeur connu :
  - `youtube.com/embed/`, `youtube-nocookie.com/embed/`, `youtu.be/`
  - `player.vimeo.com/video/`
- Les conteneurs de players JS courants (attributs `data-vimeo-id`, `data-youtube-id`)

**[Implémentation]** La détection va plus loin : le content script s'exécute dans **toutes les frames** (y compris iframes cross-origin) ; elle couvre aussi les pages de lecture (YouTube watch/shorts, Vimeo, Google Drive `/file/d/…`), les `<video>` dans des shadow roots **ouverts**, les façades « clic pour charger » (`lite-youtube`, `data-youtube-id`, miniatures YouTube, Wistia JS) et les iframes de players hébergés (Wistia, Loom, Dailymotion, Brightcove, JW Player, Kaltura, Panopto, Streamable, Twitch). Les listes de chaque frame sont fusionnées et dédoublonnées par clé d'identité (`provider:externalId`, sinon hash de l'URL).

Un `MutationObserver` maintient la liste à jour pour les vidéos injectées dynamiquement.

**Sortie :** liste d'objets `DetectedVideo`

```json
{
  "id": "uuid-local",
  "provider": "youtube | vimeo | drive | native | unknown",
  "externalId": "identifiant chez l'hébergeur",
  "title": "titre si disponible",
  "duration": 1847,
  "iframeSrc": "url complète",
  "isPlaying": false
}
```

**Cas limites à gérer :**

- Aucune vidéo détectée → le popup l'indique explicitement
- Plusieurs vidéos → toutes listées, sélection par l'utilisateur
- Vidéo dans une iframe cross-origin → l'ID est extrait de l'URL, pas du contenu de l'iframe (inaccessible)
- Provider inconnu → la vidéo est listée mais marquée non traitable

### 3.2 F2 — Interface popup

**Vue liste**

Affiche les vidéos détectées sur l'onglet actif. Pour chaque entrée :

- Titre (ou « Vidéo sans titre »)
- Hébergeur (badge)
- Durée si connue
- Statut : `Non traitée` / `En cours` / `Terminée` / `Échec`
- Bouton **Résumer** (**[Implémentation]** aussi : **Résumer la sélection / tout**, bouton **Rescanner**, **Annuler** sur une vidéo en cours ou en file)

**Vue traitement**

Pendant le traitement, affiche la progression par étape :

```
[✓] Détection
[✓] Recherche des sous-titres
[⟳] Transcription audio (3 min 20 / 12 min)
[ ] Génération du résumé
```

**[Implémentation]** Une barre de progression pondérée et monotone accompagne les étapes (captions 0→15 %, résumé 15→100 % ; audio : téléchargement 0→30, extraction 30, transcription 30→85, résumé 85→100), avec un temps restant estimé quand le débit est stable. Les vidéos audio sont traitées une à la fois : les suivantes affichent « en attente (n devant) ».

Le traitement se poursuit si le popup est fermé (exécution dans le service worker). À la réouverture, l'état est restauré.

**Vue résultat**

- Résumé affiché en Markdown rendu
- Bouton **Télécharger** (`.md`) — **[Implémentation]** remplacé par **PDF** et **Word (.docx)** ; le format par défaut est un réglage
- Bouton **Copier** — **[Implémentation]** copie du texte brut (sans syntaxe Markdown)
- Indication du chemin emprunté : « Sous-titres YouTube », « Transcription audio », « Vidéo YouTube (Gemini) »
- **[Implémentation]** Sélecteur de longueur Court / Standard / Détaillé : choix d'affichage appliqué au rendu local, instantané et sans nouvel appel au modèle

**Vue paramètres**

- Clé API OpenRouter (masquée, stockée dans `chrome.storage.local`)
- Clé API du service de transcription — **[Implémentation]** seulement si le fournisseur choisi est OpenAI Whisper ; par défaut la clé OpenRouter sert aussi à la transcription audio
- Sélection du modèle de résumé
- Choix du template de résumé — **[Implémentation]** non exposé : un seul template versionné
- Langue de sortie
- **[Implémentation]** Langue de l'interface, thème, format d'export par défaut, longueur du résumé, section Diagnostic (copier / télécharger le rapport, effacer les logs), relecture de l'introduction

### 3.3 F3 — Adaptateur YouTube

**Chemin nominal.** Fiabilité élevée : YouTube génère des sous-titres automatiques sur la quasi-totalité des vidéos, y compris non listées.

**Procédure :**

1. Extraire l'ID vidéo depuis l'URL de l'iframe
2. Récupérer la liste des pistes de sous-titres disponibles
3. Priorité de sélection :
   - Piste manuelle en langue préférée
   - Piste automatique en langue préférée
   - Piste manuelle dans une autre langue
   - Piste automatique dans une autre langue
4. Télécharger et parser la piste
5. Normaliser en objet `Transcript`

**Gestion d'erreur :** si aucune piste n'est disponible, remonter un échec typé `NO_CAPTIONS_AVAILABLE` et déclencher le niveau 2. **[Implémentation]** YouTube bloque souvent le contenu des pistes (`CAPTIONS_BLOCKED`) ; dans ce cas comme en l'absence de piste, c'est Gemini qui regarde l'URL (voir §2.1), sans passer par le niveau 2.

### 3.4 F4 — Adaptateur Vimeo

**Chemin dégradé attendu.** Il a été constaté sur le site cible que le bouton CC est absent, ce qui suggère une absence de piste de sous-titres. L'adaptateur doit néanmoins tenter le niveau 1 avant de basculer.

**Procédure niveau 1 :**

1. Extraire l'ID vidéo depuis l'URL du player
2. Interroger la configuration du player pour lister les `text_tracks`
3. Si une piste existe, la télécharger et la parser
4. Sinon, échec typé `NO_CAPTIONS_AVAILABLE`

**Procédure niveau 2 :** voir F5.

### 3.5 F5 — Fallback transcription audio

**Déclenchement :** échec du niveau 1 sur un provider donné (ou absence d'adaptateur : `<video>` natif, Drive, players hébergés).

> **Note pour l'agent :** ce module est le point technique le plus délicat et le plus fragile du projet. Il doit être **strictement isolé** derrière une interface stable afin de pouvoir être remplacé sans impacter le reste de l'extension. Il est établi que le contenu n'est pas protégé par DRM (des outils de téléchargement génériques fonctionnent sur ce site), ce qui rend l'approche viable.

**Étapes :**

1. **Capture du flux média**
   Le service worker écoute les requêtes réseau de l'onglet via `chrome.webRequest` et identifie les URL de segments média (`.m3u8`, `.mpd`, `.mp4`, segments `vimeocdn.com`). **[Implémentation]** Les captures sont rattachées à la frame émettrice et vidées à la navigation ; Drive passe par des plages d'octets `videoplayback` (`googlevideo.com`, `*.c.drive.google.com`, `*.c.docs.google.com`). Si rien n'est capturé, la vidéo est lancée muette ~5 s par le content script (`PRIME_MEDIA`). Les flux DASH seuls ne sont pas assemblés.

2. **Récupération**
   Les segments sont téléchargés avec les cookies du navigateur et assemblés **en mémoire** du document offscreen (jamais écrits sur disque). Limite : 1 Gio de source (`MEDIA_TOO_LARGE` au-delà).

3. **Extraction audio**
   La piste audio est isolée du conteneur vidéo afin de réduire le volume envoyé au service de transcription, par fenêtres successives (MP3 mono 16 kHz, 64 kbps) avec `ffmpeg.wasm` (cœur mono-thread).

4. **Découpage**
   Les services de transcription imposent une limite de taille par requête (25 Mo pour l'API Whisper d'OpenAI). L'audio doit être découpé en segments avec un chevauchement de quelques secondes pour éviter les coupures en milieu de phrase. **[Implémentation]** Chemin OpenRouter : morceaux de 12 min au plus, sans chevauchement, séquentiels, avec nouvelles tentatives ; chemin Whisper : fenêtres de 24 Mio au plus, recouvrement de 5 s, dédoublonnage.

5. **Transcription**
   Envoi séquentiel des segments, réassemblage des résultats en respectant l'ordre et en dédupliquant les zones de chevauchement.

6. **Normalisation**
   Production de l'objet `Transcript`.

**Contraintes :**

- L'ensemble doit s'exécuter en arrière-plan sans bloquer la navigation
- Progression remontée au popup à chaque segment traité
- Nettoyage systématique des fichiers temporaires en fin de traitement, y compris en cas d'erreur
- Timeout configurable (défaut : 15 minutes). **[Implémentation]** Le délai est par phase (réglage `timeoutSeconds`, non exposé dans le popup) : téléchargement/extraction coupés après 120 s sans progression ; transcription = délai de base + 1 s par seconde de média (4 h max) ; résumé = délai de base + un quart de la durée.

**Erreurs typées à produire :**

| Code | Signification |
|---|---|
| `MEDIA_NOT_CAPTURABLE` | Aucun segment média identifié |
| `MEDIA_PROTECTED` | Contenu chiffré ou protégé (**[Implémentation]** : réponse 401/403 du serveur média) |
| `AUDIO_EXTRACTION_FAILED` | Échec de l'isolation audio |
| `TRANSCRIPTION_API_ERROR` | Erreur du service de transcription |
| `TIMEOUT` | Dépassement du délai global |
| `MEDIA_NEEDS_PLAYBACK` | **[Implémentation]** Aucun flux complet capturé : lancer la lecture quelques secondes |
| `MEDIA_TOO_LARGE` | **[Implémentation]** Source supérieure à 1 Gio |

### 3.6 F6 — Objet Transcript normalisé

Contrat d'interface entre les modules d'extraction et le module de résumé.

```json
{
  "videoId": "uuid-local",
  "source": "youtube_captions | vimeo_captions | audio_transcription",
  "language": "fr",
  "duration": 1847,
  "segments": [
    { "start": 0.0, "end": 4.2, "text": "Bonjour et bienvenue dans ce module." }
  ],
  "fullText": "Texte complet concaténé.",
  "metadata": {
    "title": "Titre de la vidéo",
    "provider": "vimeo",
    "extractedAt": "2026-07-24T10:30:00Z"
  }
}
```

### 3.7 F7 — Génération du résumé

**Service :** OpenRouter, avec la clé de l'utilisateur.

**Modèle recommandé :** Claude Sonnet, pour sa fidélité au respect d'un format imposé. Une alternative à contexte large et coût réduit (Gemini Flash) doit être proposée dans les paramètres pour les transcriptions très longues.

**[Implémentation]** Registre dans `src/types/settings.ts` (vérifié le 2026-10-18) : `google/gemini-3.1-flash-lite` (**défaut**), `google/gemini-3.5-flash-lite`, `google/gemini-3.5-flash`, `anthropic/claude-haiku-5.5`, `anthropic/claude-sonnet-5.5`. La transcription audio et la voie « Gemini regarde YouTube » utilisent toujours `google/gemini-3.1-flash-lite` (seuls les modèles Gemini acceptent audio/vidéo en entrée).

**Gestion des transcriptions longues :**

Si le texte dépasse la fenêtre de contexte du modèle sélectionné, appliquer une stratégie de résumé hiérarchique : découpage en blocs cohérents, résumé de chaque bloc, puis synthèse finale à partir des résumés intermédiaires.

**[Implémentation]** Le seuil dépend du modèle : condensation au-delà de la moitié de sa fenêtre de contexte (caractères ≈ jetons × 4 ; 60 000 caractères pour un modèle hors registre), par blocs de 100 000 caractères, 3 appels en parallèle ; une réponse `CONTEXT_TOO_LONG` déclenche une nouvelle tentative avec condensation.

**Template de sortie**

Le template est **versionné** et stocké dans un fichier de configuration. Il constitue le garant du formalisme constant.

Structure imposée par défaut :

```markdown
# {{titre}}

**Source :** {{provider}} · **Durée :** {{durée}} · **Extrait le :** {{date}}
**Méthode :** {{source_transcript}}

## En bref
{{3 à 5 lignes}}

## Points clés
{{liste à puces, 5 à 10 items}}

## Développement
{{sections thématiques suivant la structure de la vidéo}}

## Notions et termes techniques
{{glossaire des termes spécialisés rencontrés}}

## À retenir
{{synthèse actionnable}}
```

**Mise en œuvre technique :**

Demander au modèle une sortie **JSON structurée** correspondant aux sections ci-dessus, puis effectuer le rendu Markdown côté extension. Cette approche garantit un formalisme strictement identique d'un résumé à l'autre — le modèle ne contrôle jamais la mise en forme, seulement le contenu.

**Paramètres exposés :** modèle, langue de sortie, niveau de détail (concis / standard / détaillé), template actif (**[Implémentation]** un seul template aujourd'hui).

### 3.8 F8 — Export

- **Téléchargement** `.md` — nom de fichier : `{{date}}-{{titre-slugifié}}.md` — **[Implémentation]** remplacé par **PDF** et **Word (.docx)**
- **Copie** dans le presse-papier (texte brut)
- **Traitement par lot** : si plusieurs vidéos sont sélectionnées, proposer un fichier unique concaténé ou une archive — **[Implémentation]** les vidéos sont mises en file et traitées l'une après l'autre ; export groupé en un seul PDF

### 3.9 F9 — Stockage et historique

Stocké dans `chrome.storage.local` :

- Clés API (jamais transmises ailleurs qu'aux API concernées)
- Préférences
- Historique des résumés générés (limite configurable, défaut 50)

L'historique permet de retrouver un résumé sans retraiter la vidéo. La clé de cache est composée de `provider` + `externalId`. **[Implémentation]** La clé inclut aussi la langue de sortie et le modèle de résumé choisi ; à défaut d'identifiant hôte, on utilise un hash de l'URL du média ; un résumé issu d'un audio non attribuable à la vidéo ou couvrant moins de 80 % de sa durée n'est pas mis en cache, mais reste dans l'historique (signalé « partiel » dans le second cas). « Régénérer » ignore le cache ; l'historique se purge entrée par entrée ou en entier (Réglages). Seuls les résumés sont conservés, jamais les transcriptions.

---

## 4. Gestion des erreurs

**Principe :** aucun échec silencieux. Chaque erreur affiche à l'utilisateur ce qui a été tenté, ce qui a échoué, et l'action possible.

| Situation | Message utilisateur |
|---|---|
| Aucune vidéo détectée | « Aucune vidéo trouvée sur cette page. Lancez la lecture puis réessayez. » |
| Pas de sous-titres, transcription indisponible | « Cette vidéo n'a pas de sous-titres et la transcription audio n'est pas configurée. Ajoutez une clé de transcription dans les paramètres. » |
| Clé API absente | « Clé OpenRouter manquante. Renseignez-la dans les paramètres. » |
| Quota API dépassé | Message renvoyé par le fournisseur, affiché tel quel |
| Média non capturable | « Le flux vidéo n'a pas pu être récupéré. Cet hébergeur n'est peut-être pas supporté. » |
| Timeout | « Le traitement a dépassé le délai imparti. Essayez avec une vidéo plus courte. » |

**[Implémentation]** Les codes, leur sens et l'action à mener sont détaillés dans [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md). Les messages sont localisés (en/fr/es/de) dans `src/i18n/`.

---

## 5. Phasage de développement

**[Implémentation]** Les quatre phases sont livrées ; la suite est dans [`ROADMAP.md`](./ROADMAP.md).

### Phase 1 — Socle et chemin nominal

Périmètre : détection, adaptateur YouTube, résumé OpenRouter, popup, export.

Livrable : extension fonctionnelle sur toutes les vidéos disposant de sous-titres.

Critère de validation : un résumé conforme au template est produit sur une vidéo YouTube embarquée dans une page authentifiée.

### Phase 2 — Adaptateur Vimeo (niveau 1)

Périmètre : détection Vimeo, tentative de récupération des `text_tracks`.

Livrable : couverture Vimeo lorsque des sous-titres existent.

Critère de validation : basculement propre vers un échec typé lorsque la piste est absente.

### Phase 3 — Fallback transcription

Périmètre : capture des segments, extraction audio, découpage, transcription, réassemblage.

Livrable : couverture complète y compris sans sous-titres.

Critère de validation : une vidéo Vimeo sans CC produit un résumé conforme au même template.

### Phase 4 — Finitions

Traitement par lot, historique, templates multiples, gestion fine des quotas.

---

## 6. Critères d'acceptation

- [x] L'extension détecte les vidéos YouTube et Vimeo embarquées dans une page authentifiée
- [x] Le traitement se poursuit lorsque le popup est fermé
- [x] Un résumé produit via sous-titres et un résumé produit via transcription audio présentent une structure strictement identique
- [x] Toute erreur affiche une cause explicite et une action possible
- [x] Les clés API ne sont transmises qu'aux fournisseurs concernés
- [x] Les fichiers temporaires sont supprimés en fin de traitement, y compris en cas d'erreur
- [x] Le résumé est téléchargeable — **[Implémentation]** en PDF ou Word (le Markdown n'est plus proposé en téléchargement)

---

## 7. Points ouverts

| Sujet | À trancher |
|---|---|
| Service de transcription | **Tranché en partie :** Gemini via OpenRouter par défaut, OpenAI Whisper (~0,006 $/min) en option ; Deepgram non retenu |
| Compatibilité Firefox | Manifest V3 y est partiellement supporté ; à évaluer si le besoin existe |
| Alternative Gemini | **Tranché :** la transcription passe par un modèle Gemini via OpenRouter (une seule clé), mais en deux appels distincts (transcription, puis résumé) pour garder le contrôle du formalisme |
| Langue des vidéos | **Tranché :** la langue parlée est détectée automatiquement (non forcée) ; la langue du résumé est un réglage indépendant |

---

## 8. Note sur le périmètre technique

Le module d'extraction audio (F5) décrit **ce qui doit être obtenu**, non la manière de contourner un player propriétaire. L'implémentation devra s'appuyer sur les mécanismes documentés et sur le fait que le contenu n'est pas protégé par DRM. Si un chiffrement est rencontré, l'erreur `MEDIA_PROTECTED` doit être remontée sans tentative de contournement.
