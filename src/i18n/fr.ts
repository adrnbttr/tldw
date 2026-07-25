import type { Messages } from './types';

export const fr: Messages = {
  list: {
    historyTooltip: 'Historique',
    settingsTooltip: 'Paramètres',
    emptyTitle: 'Aucune vidéo trouvée sur cette page.',
    emptyHint: 'Lancez la lecture puis rouvrez ce menu.',
    noTitle: 'Vidéo sans titre',
    videoLabel: 'Vidéo',
    untreatable: 'non traitable',
    summarize: 'Résumer',
    summarizeSelection: (count) => `Résumer la sélection (${count})`,
  },
  transcription: {
    fetchingMedia: 'Récupération du flux média…',
    extractingAudio: 'Extraction de la piste audio…',
    assembling: (index, total) => `Assemblage des segments (${index}/${total})…`,
    transcribing: (index, total, clock) => `Transcription ${index}/${total} (${clock})…`,
  },
  processing: {
    back: '← Retour',
    steps: {
      detect: 'Détection',
      captions: 'Recherche des sous-titres',
      audio_capture: 'Capture du flux média',
      transcription: 'Transcription audio',
      summarize: 'Génération du résumé',
    },
    failedTitle: 'Échec',
    backToList: 'Retour à la liste',
    cancel: 'Annuler',
  },
  result: {
    back: '← Retour',
    heading: 'Résumé',
    method: (source) => `Méthode : ${source}`,
    download: 'Télécharger (.md)',
    copy: 'Copier',
    copied: 'Copié ✓',
  },
  settings: {
    back: '← Retour',
    heading: 'Paramètres',
    openRouterKey: 'Clé API OpenRouter',
    transcriptionKey: 'Clé API transcription (fallback audio)',
    transcriptionPlaceholder: 'optionnelle',
    model: 'Modèle de résumé',
    outputLanguage: 'Langue du résumé',
    uiLanguage: "Langue de l'interface",
    detailLevel: 'Niveau de détail',
    detailLevels: { concise: 'Concis', standard: 'Standard', detailed: 'Détaillé' },
    template: 'Template de résumé',
    save: 'Enregistrer',
    saved: 'Enregistré ✓',
  },
  history: {
    back: '← Retour',
    heading: 'Historique',
    empty: "Aucun résumé enregistré pour l'instant.",
  },
  batch: {
    back: '← Retour',
    heading: 'Traitement par lot',
    progress: (completed, total) => `${completed} / ${total} traitées`,
    current: (title) => `En cours : ${title}`,
    downloadAll: (count) => `Tout télécharger (${count}) en un fichier .md`,
  },
  sources: {
    youtube_captions: 'Sous-titres YouTube',
    vimeo_captions: 'Sous-titres Vimeo',
    audio_transcription: 'Transcription audio',
  },
  errors: {
    NO_VIDEO_DETECTED: 'Aucune vidéo trouvée sur cette page. Lancez la lecture puis réessayez.',
    NO_CAPTIONS_AVAILABLE:
      "Cette vidéo n'a pas de sous-titres et la transcription audio n'est pas configurée. Ajoutez une clé de transcription dans les paramètres.",
    MISSING_OPENROUTER_KEY: 'Clé OpenRouter manquante. Renseignez-la dans les paramètres.',
    MISSING_TRANSCRIPTION_KEY:
      'Clé de transcription manquante. Renseignez-la dans les paramètres pour activer le fallback audio.',
    QUOTA_EXCEEDED: 'Quota API dépassé.',
    MEDIA_NOT_CAPTURABLE:
      "Le flux vidéo n'a pas pu être récupéré. Cet hébergeur n'est peut-être pas supporté.",
    MEDIA_PROTECTED:
      'Le contenu est protégé (chiffré). La transcription audio ne peut pas être effectuée.',
    AUDIO_EXTRACTION_FAILED: "L'isolation de la piste audio a échoué.",
    TRANSCRIPTION_API_ERROR: 'Le service de transcription a renvoyé une erreur.',
    TIMEOUT: 'Le traitement a dépassé le délai imparti. Essayez avec une vidéo plus courte.',
    UNSUPPORTED_PROVIDER: "Cet hébergeur n'est pas encore supporté.",
    SUMMARY_API_ERROR: 'La génération du résumé a échoué.',
    UNKNOWN: "Une erreur inattendue s'est produite.",
  },
};
