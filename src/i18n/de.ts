import type { Messages } from './types';
import { formatNumber, plural } from './format';

/* German: address the user with « du » everywhere; no-break space before units and %. */
const n = (v: number) => formatNumber('de', v);

export const de: Messages = {
  locale: 'de',
  nav: { videos: 'Videos' },
  list: {
    historyTooltip: 'Verlauf',
    settingsTooltip: 'Einstellungen',
    rescanTooltip: 'Seite erneut nach Videos durchsuchen',
    emptyTitle: 'Kein Video auf dieser Seite erkannt',
    emptyHint: 'Spiele das Video ein paar Sekunden ab und durchsuche die Seite dann erneut.',
    emptySites:
      'Funktioniert mit YouTube, Vimeo, Google Drive und den meisten Videoplayern auf Websites.',
    rescan: 'Erneut suchen',
    loading: 'Videos werden gesucht…',
    noTitle: 'Video ohne Titel',
    videoLabel: 'Video',
    untreatable: 'nicht unterstützt',
    summarize: 'Zusammenfassen',
    retry: 'Erneut versuchen',
    summarizeSelection: (count) => `Auswahl zusammenfassen (${count})`,
    summarizeAll: (count) => `Alle zusammenfassen (${count})`,
    view: 'Zusammenfassung ansehen',
    regenerate: 'Neu erstellen',
    copyReport: 'Bericht kopieren',
    overview: (total, done) =>
      `${total} ${plural('de', total, { one: 'Video', other: 'Videos' })}${done > 0 ? ` · ${done} zusammengefasst` : ''}`,
    batchProgress: (done, total) => `${done}/${total}`,
    openSettings: 'Einstellungen öffnen',
    addCredits: 'Guthaben aufladen',
    technicalDetails: 'Technische Details',
    retryIn: (s) => `Erneut versuchen in ${s}\u00A0s.`,
  },
  progress: {
    label: 'Fortschritt',
    percent: (p) => `${p}\u00A0%`,
    starting: 'Wird vorbereitet…',
    captions: 'Untertitel werden geladen…',
    queued: (k) => `Wartet (${k} ${plural('de', k, { one: 'Video', other: 'Videos' })} davor)…`,
    download: (d, t) => `Herunterladen · ${d} / ${t}\u00A0MB`,
    downloadItems: (d, t) => `Herunterladen · ${d} / ${t} Segmente`,
    downloading: 'Wird heruntergeladen…',
    extracting: 'Audio wird extrahiert…',
    transcription: (d, t) => `Transkription · ${d} / ${t} des Videos`,
    transcribing: 'Transkription…',
    summarizing: 'Zusammenfassung läuft…',
    eta: (m) =>
      m >= 60
        ? `noch ca. ${Math.floor(m / 60)}\u00A0Std. ${String(m % 60).padStart(2, '0')}\u00A0Min.`
        : `noch ca. ${m}\u00A0Min.`,
  },
  transcription: {
    fetchingMedia: 'Medienstream wird abgerufen…',
    extractingAudio: 'Audiospur wird extrahiert…',
    assembling: (index, total) => `Segmente ${index}/${total}`,
    downloading: (done, total) => `${n(done)}/${n(total)}\u00A0MB heruntergeladen`,
    transcribing: (index, total, clock) => `${index}/${total} · ${clock}`,
    transcribingOne: 'Transkription…',
    queued: 'Warten auf das vorherige Video…',
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
    length: 'Länge',
    downloadPdf: 'Als PDF herunterladen',
    downloadWord: 'Als Word herunterladen',
    copy: 'Text kopieren',
    copied: 'Kopiert ✓',
    failed: 'Fehlgeschlagen ✗',
    regenerate: 'Neu erstellen',
    partialNotice:
      'Teilweise Zusammenfassung: Nur ein Teil des Videos konnte transkribiert werden.',
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
    modelQualifiers: {
      bestValue: 'bestes Preis-Leistungs-Verhältnis',
      fast: 'schnell',
      highestFidelity: 'höchste Genauigkeit',
    },
    customModel: (id) => `Eigenes Modell: ${id}`,
    outputLanguage: 'Sprache der Zusammenfassung',
    uiLanguage: 'Sprache der Oberfläche',
    detailLevel: 'Zusammenfassungslänge',
    detailLevels: { concise: 'Kurz', standard: 'Standard', detailed: 'Ausführlich' },
    theme: 'Design',
    themeLabels: { system: 'System', light: 'Hell', dark: 'Dunkel' },
    sectionAppearance: 'Aussehen & Sprachen',
    sectionKeys: 'API-Schlüssel',
    sectionSummary: 'Zusammenfassung',
    downloadFormat: 'Standard-Exportformat',
    formatLabels: { pdf: 'PDF', docx: 'Word' },
    sectionDiagnostic: 'Diagnose',
    diagnosticHint:
      'Der Bericht wird lokal erzeugt, nichts verlässt dein Gerät, und er enthält niemals deine API-Schlüssel.',
    diagnosticCopy: 'Bericht kopieren',
    diagnosticDownload: 'Bericht herunterladen',
    diagnosticClear: 'Protokoll löschen',
    logsCleared: 'Protokoll gelöscht ✓',
    diagnosticFailed: 'Fehlgeschlagen ✗',
    sectionHistory: 'Verlauf',
    clearHistory: 'Verlauf leeren',
    clearHistoryConfirm: 'Alle gespeicherten Zusammenfassungen endgültig löschen?',
    clearHistoryConfirmAction: 'Leeren',
    clearHistoryCancel: 'Abbrechen',
    historyCleared: 'Verlauf geleert ✓',
    replayOnboarding: 'Einführung erneut ansehen',
    save: 'Speichern',
    saved: 'Gespeichert ✓',
  },
  history: {
    back: '← Zurück',
    heading: 'Verlauf',
    empty: 'Noch keine Zusammenfassung gespeichert.',
    delete: 'Löschen',
    deleteLabel: (title) => `„${title}“ löschen`,
  },
  batch: {
    back: '← Zurück',
    heading: 'Stapelverarbeitung',
    progress: (completed, total) => `${completed} / ${total} verarbeitet`,
    current: (title) => `Läuft: ${title}`,
    downloadAll: (count) => `Alle (${count}) als ein PDF herunterladen`,
  },
  keyInput: {
    show: 'Anzeigen',
    hide: 'Verbergen',
    invalidFormat:
      'Das sieht nicht nach einem OpenRouter-Schlüssel aus – er beginnt mit „sk-or-“. Prüfe, was du eingefügt hast.',
  },
  sources: {
    youtube_captions: 'YouTube-Untertitel',
    vimeo_captions: 'Vimeo-Untertitel',
    audio_transcription: 'Audio-Transkription',
    youtube_video: 'YouTube-Video (Gemini)',
  },
  errors: {
    NO_VIDEO_DETECTED:
      'Kein Video auf dieser Seite erkannt. Starte die Wiedergabe und versuche es erneut.',
    NO_CAPTIONS_AVAILABLE:
      'Dieses Video hat keine Untertitel und die Audio-Transkription ist nicht eingerichtet. Füge in den Einstellungen einen Transkriptionsschlüssel hinzu.',
    CAPTIONS_BLOCKED:
      'YouTube blockiert derzeit den Untertitel-Download für dieses Video — eine YouTube-Einschränkung, kein tldw-Fehler.',
    MISSING_OPENROUTER_KEY: 'OpenRouter-Schlüssel fehlt. Füge ihn in den Einstellungen hinzu.',
    MISSING_TRANSCRIPTION_KEY:
      'Transkriptionsschlüssel fehlt. Füge ihn in den Einstellungen hinzu, um die Audio-Transkription zu aktivieren.',
    QUOTA_EXCEEDED: 'API-Kontingent überschritten.',
    INVALID_API_KEY: 'Ungültiger OpenRouter-API-Schlüssel. Prüfe ihn in den Einstellungen.',
    INVALID_TRANSCRIPTION_KEY:
      'Ungültiger OpenAI-Schlüssel (Transkription). Prüfe ihn in den Einstellungen.',
    INSUFFICIENT_CREDITS:
      'Nicht genügend OpenRouter-Guthaben. Lade unter openrouter.ai/credits Guthaben auf und versuche es erneut.',
    RATE_LIMITED: 'Zu viele Anfragen (Ratenlimit). Warte kurz und versuche es dann erneut.',
    MODEL_UNAVAILABLE:
      'Das gewählte Modell ist auf OpenRouter nicht verfügbar. Wähle in den Einstellungen ein anderes Modell.',
    CONTEXT_TOO_LONG:
      'Das Transkript ist für das gewählte Modell zu lang. Wähle in den Einstellungen ein Modell mit größerem Kontext.',
    MEDIA_NOT_CAPTURABLE:
      'Der Videostream konnte nicht abgerufen werden. Dieser Anbieter wird möglicherweise nicht unterstützt.',
    MEDIA_NEEDS_PLAYBACK:
      'Spiele das Video ein paar Sekunden ab und versuche es erneut — der Stream muss erst laden.',
    MEDIA_PROTECTED:
      'Zugriff vom Videoserver verweigert. Starte die Wiedergabe des Videos neu und versuche es dann erneut. DRM-geschützte Videos werden nicht unterstützt.',
    MEDIA_TOO_LARGE:
      'Dieses Video ist zu groß, um es im Speicher zu verarbeiten. Versuche ein kürzeres.',
    AUDIO_EXTRACTION_FAILED: 'Das Isolieren der Audiospur ist fehlgeschlagen.',
    TRANSCRIPTION_API_ERROR: 'Der Transkriptionsdienst hat einen Fehler zurückgegeben.',
    TIMEOUT: 'Die Verarbeitung hat das Zeitlimit überschritten. Versuche ein kürzeres Video.',
    UNSUPPORTED_PROVIDER: 'Dieser Anbieter wird noch nicht unterstützt.',
    SUMMARY_API_ERROR: 'Die Zusammenfassung konnte nicht erstellt werden. Versuche es erneut.',
    CANCELLED: 'Abgebrochen.',
    INTERRUPTED:
      'Unterbrochen: Die Erweiterung wurde im Hintergrund neu gestartet. Starte die Zusammenfassung erneut.',
    UNKNOWN: 'Ein unerwarteter Fehler ist aufgetreten.',
  },
  onboarding: {
    next: 'Weiter',
    back: 'Zurück',
    skip: 'Überspringen',
    finish: 'Loslegen',
    getStarted: 'Loslegen',
    welcomeTitle: 'Willkommen bei tldw',
    welcomeBody:
      'Verwandle die Videos einer Seite in klare, strukturierte Zusammenfassungen, die in einer Minute lesbar sind — YouTube, Vimeo oder jedes Video. Richten wir es in 30 Sekunden ein.',
    langTitle: 'Deine Sprachen',
    langBody:
      'Wähle die Sprache der Erweiterung und die Sprache, in der deine Zusammenfassungen geschrieben werden.',
    themeTitle: 'Wähle das Design',
    themeBody: 'Folge deinem System, oder erzwinge Hell oder Dunkel.',
    keyTitle: 'OpenRouter verbinden',
    keyBody:
      'tldw nutzt deinen eigenen OpenRouter-Schlüssel für die Zusammenfassungen — ein Konto, kein Abo, du zahlst nur, was du nutzt.',
    keyCost:
      'Eine Zusammenfassung kostet mit Untertiteln etwa einen Cent oder weniger, bei einem einstündigen Video, das aus dem Ton transkribiert wird, rund 5–10 Cent. Dein Schlüssel bleibt auf deinem Gerät.',
    keyGet: 'Kostenlosen Schlüssel holen ↗',
    keyPlaceholder: 'OpenRouter-Schlüssel einfügen (sk-or-…)',
    keyLater: 'Du kannst ihn später in den Einstellungen hinzufügen.',
    doneTitle: 'Alles bereit 🎉',
    doneBody:
      'Öffne eine Seite mit einem Video und klicke auf das tldw-Symbol. Du kannst alles jederzeit in den Einstellungen ändern.',
  },
};
