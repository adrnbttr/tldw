import type { Messages } from './types';
import { formatNumber, plural } from './format';

/*
 * French typography: typographic apostrophe (’), narrow no-break space
 * (U+202F) before ? ! : ; and before units and %, « guillemets ».
 * Address the user as « vous » everywhere.
 */
const n = (v: number) => formatNumber('fr', v);

export const fr: Messages = {
  locale: 'fr',
  nav: { videos: 'Vidéos' },
  list: {
    historyTooltip: 'Historique',
    settingsTooltip: 'Réglages',
    rescanTooltip: 'Rechercher à nouveau les vidéos de la page',
    emptyTitle: 'Aucune vidéo détectée sur cette page',
    emptyHint: 'Lancez la lecture de la vidéo quelques secondes, puis relancez la recherche.',
    emptySites:
      'Fonctionne avec YouTube, Vimeo, Google Drive et la plupart des lecteurs vidéo des sites.',
    rescan: 'Rechercher à nouveau',
    loading: 'Recherche des vidéos…',
    noTitle: 'Vidéo sans titre',
    videoLabel: 'Vidéo',
    untreatable: 'non prise en charge',
    summarize: 'Résumer',
    retry: 'Réessayer',
    summarizeSelection: (count) => `Résumer la sélection (${count})`,
    summarizeAll: (count) => `Tout résumer (${count})`,
    view: 'Voir le résumé',
    regenerate: 'Régénérer',
    copyReport: 'Copier le rapport',
    overview: (total, done) =>
      `${total} ${plural('fr', total, { one: 'vidéo', other: 'vidéos' })}${
        done > 0 ? ` · ${done} ${plural('fr', done, { one: 'résumée', other: 'résumées' })}` : ''
      }`,
    batchProgress: (done, total) => `${done}/${total}`,
    openSettings: 'Ouvrir les réglages',
    addCredits: 'Ajouter des crédits',
    technicalDetails: 'Détails techniques',
    retryIn: (s) => `Réessayez dans ${s}\u202Fs.`,
  },
  progress: {
    label: 'Progression',
    percent: (p) => `${p}\u202F%`,
    starting: 'Préparation…',
    captions: 'Récupération des sous-titres…',
    queued: (k) => `En attente (${k} ${plural('fr', k, { one: 'vidéo', other: 'vidéos' })} avant)…`,
    download: (d, t) => `Téléchargement · ${d} / ${t}\u202FMo`,
    downloadItems: (d, t) => `Téléchargement · ${d} / ${t} segments`,
    downloading: 'Téléchargement…',
    extracting: 'Extraction de l’audio…',
    transcription: (d, t) => `Transcription · ${d} / ${t} de vidéo`,
    transcribing: 'Transcription…',
    summarizing: 'Rédaction du résumé…',
    eta: (m) =>
      m >= 60
        ? `≈\u00A0${Math.floor(m / 60)}\u202Fh\u202F${String(m % 60).padStart(2, '0')} restantes`
        : `≈\u00A0${m}\u202Fmin ${plural('fr', m, { one: 'restante', other: 'restantes' })}`,
  },
  transcription: {
    fetchingMedia: 'Récupération du flux média…',
    extractingAudio: 'Extraction de la piste audio…',
    assembling: (index, total) => `Segments ${index}/${total}`,
    downloading: (done, total) => `${n(done)} / ${n(total)}\u202FMo téléchargés`,
    transcribing: (index, total, clock) => `${index}/${total} · ${clock}`,
    transcribingOne: 'Transcription…',
    queued: 'En attente de la vidéo précédente…',
  },
  processing: {
    back: '← Retour',
    steps: {
      detect: 'Détection',
      captions: 'Recherche des sous-titres',
      audio_capture: 'Capture du flux média',
      transcription: 'Transcription de l’audio',
      summarize: 'Rédaction du résumé',
    },
    analyzingVideo: 'Analyse de la vidéo…',
    failedTitle: 'Échec',
    backToList: 'Retour à la liste',
    cancel: 'Annuler',
  },
  result: {
    back: '← Retour',
    heading: 'Résumé',
    method: (source) => `Méthode\u202F: ${source}`,
    length: 'Longueur',
    downloadPdf: 'Télécharger en PDF',
    downloadWord: 'Télécharger en Word',
    copy: 'Copier le texte',
    copied: 'Copié ✓',
    failed: 'Échec ✗',
    regenerate: 'Régénérer',
    partialNotice: 'Résumé partiel\u202F: seule une partie de la vidéo a pu être transcrite.',
  },
  settings: {
    back: '← Retour',
    heading: 'Réglages',
    openRouterKey: 'Clé API OpenRouter',
    transcriptionProvider: 'Transcription de l’audio (vidéos sans sous-titres)',
    providerOpenRouter: 'OpenRouter — Gemini (utilise votre clé OpenRouter)',
    providerOpenAI: 'OpenAI — Whisper (nécessite une clé distincte)',
    transcriptionKey: 'Clé API OpenAI (Whisper)',
    transcriptionPlaceholder: 'facultative',
    model: 'Modèle de résumé',
    modelQualifiers: {
      bestValue: 'meilleur rapport qualité-prix',
      fast: 'rapide',
      highestFidelity: 'fidélité maximale',
    },
    customModel: (id) => `Modèle personnalisé\u202F: ${id}`,
    outputLanguage: 'Langue du résumé',
    uiLanguage: 'Langue de l’interface',
    detailLevel: 'Longueur du résumé',
    detailLevels: { concise: 'Court', standard: 'Standard', detailed: 'Détaillé' },
    theme: 'Thème',
    themeLabels: { system: 'Système', light: 'Clair', dark: 'Sombre' },
    sectionAppearance: 'Apparence et langues',
    sectionKeys: 'Clés API',
    sectionSummary: 'Résumé',
    downloadFormat: 'Format d’export par défaut',
    formatLabels: { pdf: 'PDF', docx: 'Word' },
    sectionDiagnostic: 'Diagnostic',
    diagnosticHint:
      'Le rapport est généré localement, rien ne quitte votre appareil, et il ne contient jamais vos clés API.',
    diagnosticCopy: 'Copier le rapport',
    diagnosticDownload: 'Télécharger le rapport',
    diagnosticClear: 'Effacer le journal',
    logsCleared: 'Journal effacé ✓',
    diagnosticFailed: 'Échec ✗',
    sectionHistory: 'Historique',
    clearHistory: 'Vider l’historique',
    clearHistoryConfirm: 'Supprimer définitivement tous les résumés enregistrés\u202F?',
    clearHistoryConfirmAction: 'Vider',
    clearHistoryCancel: 'Annuler',
    historyCleared: 'Historique vidé ✓',
    replayOnboarding: 'Revoir la présentation',
    save: 'Enregistrer',
    saved: 'Enregistré ✓',
  },
  history: {
    back: '← Retour',
    heading: 'Historique',
    empty: 'Aucun résumé enregistré pour l’instant.',
    delete: 'Supprimer',
    deleteLabel: (title) => `Supprimer «\u202F${title}\u202F»`,
  },
  batch: {
    back: '← Retour',
    heading: 'Traitement par lot',
    progress: (completed, total) =>
      `${completed} / ${total} ${plural('fr', completed, { one: 'traitée', other: 'traitées' })}`,
    current: (title) => `En cours\u202F: ${title}`,
    downloadAll: (count) => `Tout télécharger (${count}) en un PDF`,
  },
  keyInput: {
    show: 'Afficher',
    hide: 'Masquer',
    invalidFormat:
      'Cette valeur ne ressemble pas à une clé OpenRouter, qui commence par «\u202Fsk-or-\u202F». Vérifiez le copier-coller.',
  },
  sources: {
    youtube_captions: 'Sous-titres YouTube',
    vimeo_captions: 'Sous-titres Vimeo',
    audio_transcription: 'Transcription de l’audio',
    youtube_video: 'Vidéo YouTube (Gemini)',
  },
  errors: {
    NO_VIDEO_DETECTED: 'Aucune vidéo détectée sur cette page. Lancez la lecture, puis réessayez.',
    NO_CAPTIONS_AVAILABLE:
      'Cette vidéo n’a pas de sous-titres et la transcription de l’audio n’est pas configurée. Ajoutez une clé de transcription dans les Réglages.',
    CAPTIONS_BLOCKED:
      'YouTube bloque actuellement le téléchargement des sous-titres de cette vidéo. Il s’agit d’une restriction de YouTube, pas d’un bogue de tldw.',
    MISSING_OPENROUTER_KEY: 'Clé OpenRouter manquante. Renseignez-la dans les Réglages.',
    MISSING_TRANSCRIPTION_KEY:
      'Clé de transcription manquante. Renseignez-la dans les Réglages pour activer la transcription de l’audio.',
    QUOTA_EXCEEDED: 'Quota de l’API dépassé.',
    INVALID_API_KEY: 'Clé API OpenRouter invalide. Vérifiez-la dans les Réglages.',
    INVALID_TRANSCRIPTION_KEY:
      'Clé OpenAI (transcription) invalide. Vérifiez-la dans les Réglages.',
    INSUFFICIENT_CREDITS:
      'Crédits OpenRouter insuffisants. Ajoutez des crédits sur openrouter.ai/credits, puis réessayez.',
    RATE_LIMITED:
      'Trop de requêtes envoyées (limite de débit). Patientez un instant, puis réessayez.',
    MODEL_UNAVAILABLE:
      'Le modèle choisi n’est pas disponible sur OpenRouter. Choisissez-en un autre dans les Réglages.',
    CONTEXT_TOO_LONG:
      'La transcription est trop longue pour ce modèle. Choisissez un modèle à plus grand contexte dans les Réglages.',
    MEDIA_NOT_CAPTURABLE:
      'Le flux vidéo n’a pas pu être récupéré. Ce site n’est peut-être pas pris en charge.',
    MEDIA_NEEDS_PLAYBACK:
      'Lancez la lecture de la vidéo quelques secondes, puis réessayez\u202F: le flux doit d’abord se charger.',
    MEDIA_PROTECTED:
      'Accès refusé par le serveur vidéo. Relancez la lecture de la vidéo puis réessayez. Les vidéos protégées par DRM ne sont pas prises en charge.',
    MEDIA_TOO_LARGE:
      'Cette vidéo est trop volumineuse pour être traitée en mémoire. Essayez une vidéo plus courte.',
    AUDIO_EXTRACTION_FAILED: 'L’extraction de la piste audio a échoué.',
    TRANSCRIPTION_API_ERROR: 'Le service de transcription a renvoyé une erreur.',
    TIMEOUT: 'Le traitement a dépassé le délai imparti. Essayez une vidéo plus courte.',
    UNSUPPORTED_PROVIDER: 'Ce site n’est pas encore pris en charge.',
    SUMMARY_API_ERROR: 'La rédaction du résumé a échoué. Réessayez.',
    CANCELLED: 'Annulé.',
    INTERRUPTED: 'Interrompu\u202F: l’extension a redémarré en arrière-plan. Relancez le résumé.',
    UNKNOWN: 'Une erreur inattendue s’est produite.',
  },
  onboarding: {
    next: 'Suivant',
    back: 'Retour',
    skip: 'Passer',
    finish: 'Commencer',
    getStarted: 'Commencer',
    welcomeTitle: 'Bienvenue dans tldw',
    welcomeBody:
      'Transformez les vidéos d’une page en résumés clairs et structurés, lisibles en une minute\u202F: YouTube, Vimeo ou n’importe quelle vidéo. La configuration prend 30\u202Fsecondes.',
    langTitle: 'Vos langues',
    langBody:
      'Choisissez la langue de l’extension et celle dans laquelle vos résumés seront rédigés.',
    themeTitle: 'Choisissez l’apparence',
    themeBody: 'Suivez votre système, ou imposez le mode clair ou sombre.',
    keyTitle: 'Connectez OpenRouter',
    keyBody:
      'tldw utilise votre propre clé OpenRouter pour rédiger les résumés\u202F: un seul compte, sans abonnement, vous ne payez que ce que vous utilisez.',
    keyCost:
      'Un résumé coûte environ un centime ou moins avec les sous-titres, et 5 à 10 centimes pour une vidéo d’1 heure transcrite depuis l’audio. Votre clé reste sur votre appareil.',
    keyGet: 'Obtenir une clé gratuite ↗',
    keyPlaceholder: 'Collez votre clé OpenRouter (sk-or-…)',
    keyLater: 'Vous pourrez l’ajouter plus tard dans les Réglages.',
    doneTitle: 'Tout est prêt 🎉',
    doneBody:
      'Ouvrez une page avec une vidéo, puis cliquez sur l’icône tldw. Tout se modifie à tout moment dans les Réglages.',
  },
};
