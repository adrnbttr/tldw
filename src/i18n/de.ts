import type { Messages } from './types';

export const de: Messages = {
  list: {
    historyTooltip: 'Verlauf',
    settingsTooltip: 'Einstellungen',
    emptyTitle: 'Kein Video auf dieser Seite gefunden.',
    emptyHint: 'Starte die Wiedergabe und öffne dieses Menü erneut.',
    noTitle: 'Video ohne Titel',
    videoLabel: 'Video',
    untreatable: 'nicht unterstützt',
    summarize: 'Zusammenfassen',
    summarizeSelection: (count) => `Auswahl zusammenfassen (${count})`,
  },
  transcription: {
    fetchingMedia: 'Medienstream wird abgerufen…',
    extractingAudio: 'Audiospur wird extrahiert…',
    assembling: (index, total) => `Segmente ${index}/${total}`,
    transcribing: (index, total, clock) => `${index}/${total} · ${clock}`,
    transcribingOne: 'Transkription…',
  },
  processing: {
    back: '← Zurück',
    steps: {
      detect: 'Erkennung',
      captions: 'Suche nach Untertiteln',
      audio_capture: 'Medienstream wird erfasst',
      transcription: 'Audio-Transkription',
      summarize: 'Zusammenfassung wird erstellt',
    },
    analyzingVideo: 'Video wird analysiert…',
    failedTitle: 'Fehlgeschlagen',
    backToList: 'Zurück zur Liste',
    cancel: 'Abbrechen',
  },
  result: {
    back: '← Zurück',
    heading: 'Zusammenfassung',
    method: (source) => `Methode: ${source}`,
    downloadPdf: 'Herunterladen (PDF)',
    downloadWord: 'Word',
    copy: 'Kopieren',
    copied: 'Kopiert ✓',
  },
  settings: {
    back: '← Zurück',
    heading: 'Einstellungen',
    openRouterKey: 'OpenRouter-API-Schlüssel',
    transcriptionProvider: 'Audio-Transkription (Videos ohne Untertitel)',
    providerOpenRouter: 'OpenRouter — Gemini (nutzt deinen OpenRouter-Schlüssel)',
    providerOpenAI: 'OpenAI — Whisper (benötigt einen separaten Schlüssel)',
    transcriptionKey: 'OpenAI-API-Schlüssel (Whisper)',
    transcriptionPlaceholder: 'optional',
    model: 'Zusammenfassungsmodell',
    outputLanguage: 'Sprache der Zusammenfassung',
    uiLanguage: 'Sprache der Oberfläche',
    detailLevel: 'Zusammenfassungslänge',
    detailLevels: { concise: 'Kurz', standard: 'Standard', detailed: 'Ausführlich' },
    template: 'Zusammenfassungsvorlage',
    save: 'Speichern',
    saved: 'Gespeichert ✓',
  },
  history: {
    back: '← Zurück',
    heading: 'Verlauf',
    empty: 'Noch keine Zusammenfassung gespeichert.',
  },
  batch: {
    back: '← Zurück',
    heading: 'Stapelverarbeitung',
    progress: (completed, total) => `${completed} / ${total} verarbeitet`,
    current: (title) => `Läuft: ${title}`,
    downloadAll: (count) => `Alle (${count}) als ein PDF herunterladen`,
  },
  sources: {
    youtube_captions: 'YouTube-Untertitel',
    vimeo_captions: 'Vimeo-Untertitel',
    audio_transcription: 'Audio-Transkription',
    youtube_video: 'YouTube-Video (Gemini)',
  },
  errors: {
    NO_VIDEO_DETECTED:
      'Kein Video auf dieser Seite gefunden. Starte die Wiedergabe und versuche es erneut.',
    NO_CAPTIONS_AVAILABLE:
      'Dieses Video hat keine Untertitel und die Audio-Transkription ist nicht eingerichtet. Füge in den Einstellungen einen Transkriptionsschlüssel hinzu.',
    CAPTIONS_BLOCKED:
      'YouTube blockiert derzeit den Untertitel-Download für dieses Video — eine YouTube-Einschränkung, kein tldw-Fehler.',
    MISSING_OPENROUTER_KEY: 'OpenRouter-Schlüssel fehlt. Füge ihn in den Einstellungen hinzu.',
    MISSING_TRANSCRIPTION_KEY:
      'Transkriptionsschlüssel fehlt. Füge ihn in den Einstellungen hinzu, um den Audio-Fallback zu aktivieren.',
    QUOTA_EXCEEDED: 'API-Kontingent überschritten.',
    MEDIA_NOT_CAPTURABLE:
      'Der Videostream konnte nicht abgerufen werden. Dieser Anbieter wird möglicherweise nicht unterstützt.',
    MEDIA_NEEDS_PLAYBACK:
      'Spiele das Video ein paar Sekunden ab und versuche es erneut — der Stream muss erst laden.',
    MEDIA_PROTECTED:
      'Der Inhalt ist geschützt (verschlüsselt). Eine Audio-Transkription ist nicht möglich.',
    AUDIO_EXTRACTION_FAILED: 'Das Isolieren der Audiospur ist fehlgeschlagen.',
    TRANSCRIPTION_API_ERROR: 'Der Transkriptionsdienst hat einen Fehler zurückgegeben.',
    TIMEOUT: 'Die Verarbeitung hat das Zeitlimit überschritten. Versuche ein kürzeres Video.',
    UNSUPPORTED_PROVIDER: 'Dieser Anbieter wird noch nicht unterstützt.',
    SUMMARY_API_ERROR: 'Die Zusammenfassung konnte nicht erstellt werden.',
    UNKNOWN: 'Ein unerwarteter Fehler ist aufgetreten.',
  },
};
