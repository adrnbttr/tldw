import type { Messages } from './types';
import { formatNumber, plural } from './format';

/* Spanish: address the user with « tú » everywhere; no-break space before units and %. */
const n = (v: number) => formatNumber('es', v);

export const es: Messages = {
  locale: 'es',
  nav: { videos: 'Vídeos' },
  list: {
    historyTooltip: 'Historial',
    settingsTooltip: 'Ajustes',
    rescanTooltip: 'Volver a buscar vídeos en esta página',
    emptyTitle: 'No se ha detectado ningún vídeo en esta página',
    emptyHint: 'Reproduce el vídeo unos segundos y vuelve a buscar.',
    emptySites:
      'Funciona con YouTube, Vimeo, Google Drive y la mayoría de los reproductores de vídeo de las webs.',
    rescan: 'Volver a buscar',
    loading: 'Buscando vídeos…',
    noTitle: 'Vídeo sin título',
    videoLabel: 'Vídeo',
    untreatable: 'no compatible',
    summarize: 'Resumir',
    retry: 'Reintentar',
    summarizeSelection: (count) => `Resumir la selección (${count})`,
    summarizeAll: (count) => `Resumir todo (${count})`,
    view: 'Ver el resumen',
    regenerate: 'Regenerar',
    copyReport: 'Copiar el informe',
    overview: (total, done) =>
      `${total} ${plural('es', total, { one: 'vídeo', other: 'vídeos' })}${done > 0 ? ` · ${done} ${plural('es', done, { one: 'resumido', other: 'resumidos' })}` : ''}`,
    batchProgress: (done, total) => `${done}/${total}`,
    openSettings: 'Abrir ajustes',
    addCredits: 'Añadir créditos',
    technicalDetails: 'Detalles técnicos',
    retryIn: (s) => `Reinténtalo en ${s}\u00A0s.`,
  },
  progress: {
    label: 'Progreso',
    percent: (p) => `${p}\u00A0%`,
    starting: 'Preparando…',
    captions: 'Obteniendo subtítulos…',
    queued: (k) => `En espera (${k} ${plural('es', k, { one: 'vídeo', other: 'vídeos' })} antes)…`,
    download: (d, t) => `Descarga · ${d} / ${t}\u00A0MB`,
    downloadItems: (d, t) => `Descarga · ${d} / ${t} segmentos`,
    downloading: 'Descargando…',
    extracting: 'Extrayendo el audio…',
    transcription: (d, t) => `Transcripción · ${d} / ${t} de vídeo`,
    transcribing: 'Transcribiendo…',
    summarizing: 'Resumiendo…',
    eta: (m) =>
      m >= 60
        ? `Quedan ≈\u00A0${Math.floor(m / 60)}\u00A0h ${String(m % 60).padStart(2, '0')}\u00A0min`
        : `${plural('es', m, { one: 'Queda', other: 'Quedan' })} ≈\u00A0${m}\u00A0min`,
  },
  transcription: {
    fetchingMedia: 'Recuperando el flujo multimedia…',
    extractingAudio: 'Extrayendo la pista de audio…',
    assembling: (index, total) => `Segmentos ${index}/${total}`,
    downloading: (done, total) => `Descargado ${n(done)}/${n(total)}\u00A0MB`,
    transcribing: (index, total, clock) => `${index}/${total} · ${clock}`,
    transcribingOne: 'Transcribiendo…',
    queued: 'Esperando a que termine el vídeo anterior…',
  },
  processing: {
    back: '← Atrás',
    steps: {
      detect: 'Detección',
      captions: 'Buscando subtítulos',
      audio_capture: 'Capturando el flujo multimedia',
      transcription: 'Transcripción de audio',
      summarize: 'Generando el resumen',
    },
    analyzingVideo: 'Analizando el vídeo…',
    failedTitle: 'Error',
    backToList: 'Volver a la lista',
    cancel: 'Cancelar',
  },
  result: {
    back: '← Atrás',
    heading: 'Resumen',
    method: (source) => `Método: ${source}`,
    length: 'Longitud',
    downloadPdf: 'Descargar en PDF',
    downloadWord: 'Descargar en Word',
    copy: 'Copiar el texto',
    copied: 'Copiado ✓',
    failed: 'Error ✗',
    regenerate: 'Regenerar',
    partialNotice: 'Resumen parcial: solo se pudo transcribir una parte del vídeo.',
  },
  settings: {
    back: '← Atrás',
    heading: 'Ajustes',
    openRouterKey: 'Clave API de OpenRouter',
    transcriptionProvider: 'Transcripción de audio (vídeos sin subtítulos)',
    providerOpenRouter: 'OpenRouter — Gemini (usa tu clave de OpenRouter)',
    providerOpenAI: 'OpenAI — Whisper (requiere una clave aparte)',
    transcriptionKey: 'Clave API de OpenAI (Whisper)',
    transcriptionPlaceholder: 'opcional',
    model: 'Modelo de resumen',
    modelQualifiers: {
      bestValue: 'mejor relación calidad-precio',
      fast: 'rápido',
      highestFidelity: 'máxima fidelidad',
    },
    customModel: (id) => `Modelo personalizado: ${id}`,
    outputLanguage: 'Idioma del resumen',
    uiLanguage: 'Idioma de la interfaz',
    detailLevel: 'Longitud del resumen',
    detailLevels: { concise: 'Corto', standard: 'Estándar', detailed: 'Detallado' },
    theme: 'Tema',
    themeLabels: { system: 'Sistema', light: 'Claro', dark: 'Oscuro' },
    sectionAppearance: 'Apariencia e idiomas',
    sectionKeys: 'Claves API',
    sectionSummary: 'Resumen',
    downloadFormat: 'Formato de exportación por defecto',
    formatLabels: { pdf: 'PDF', docx: 'Word' },
    sectionDiagnostic: 'Diagnóstico',
    diagnosticHint:
      'El informe se genera localmente, nada sale de tu dispositivo y nunca contiene tus claves API.',
    diagnosticCopy: 'Copiar el informe',
    diagnosticDownload: 'Descargar el informe',
    diagnosticClear: 'Borrar el registro',
    logsCleared: 'Registro borrado ✓',
    diagnosticFailed: 'Error ✗',
    sectionHistory: 'Historial',
    clearHistory: 'Vaciar el historial',
    clearHistoryConfirm: '¿Eliminar definitivamente todos los resúmenes guardados?',
    clearHistoryConfirmAction: 'Vaciar',
    clearHistoryCancel: 'Cancelar',
    historyCleared: 'Historial vaciado ✓',
    replayOnboarding: 'Volver a ver la introducción',
    save: 'Guardar',
    saved: 'Guardado ✓',
  },
  history: {
    back: '← Atrás',
    heading: 'Historial',
    empty: 'Aún no hay ningún resumen guardado.',
    delete: 'Eliminar',
    deleteLabel: (title) => `Eliminar «${title}»`,
  },
  batch: {
    back: '← Atrás',
    heading: 'Procesamiento por lotes',
    progress: (completed, total) => `${completed} / ${total} procesados`,
    current: (title) => `En curso: ${title}`,
    downloadAll: (count) => `Descargar todo (${count}) en un PDF`,
  },
  keyInput: {
    show: 'Mostrar',
    hide: 'Ocultar',
    invalidFormat:
      'Esto no parece una clave de OpenRouter, que empieza por «sk-or-». Revisa lo que has pegado.',
  },
  sources: {
    youtube_captions: 'Subtítulos de YouTube',
    vimeo_captions: 'Subtítulos de Vimeo',
    audio_transcription: 'Transcripción de audio',
    youtube_video: 'Vídeo de YouTube (Gemini)',
  },
  errors: {
    NO_VIDEO_DETECTED:
      'No se ha detectado ningún vídeo en esta página. Inicia la reproducción e inténtalo de nuevo.',
    NO_CAPTIONS_AVAILABLE:
      'Este vídeo no tiene subtítulos y la transcripción de audio no está configurada. Añade una clave de transcripción en Ajustes.',
    CAPTIONS_BLOCKED:
      'YouTube está bloqueando la descarga de subtítulos de este vídeo — una restricción de YouTube, no un error de tldw.',
    MISSING_OPENROUTER_KEY: 'Falta la clave de OpenRouter. Añádela en Ajustes.',
    MISSING_TRANSCRIPTION_KEY:
      'Falta la clave de transcripción. Añádela en Ajustes para activar la transcripción de audio.',
    QUOTA_EXCEEDED: 'Cuota de la API superada.',
    INVALID_API_KEY: 'Clave API de OpenRouter no válida. Revísala en Ajustes.',
    INVALID_TRANSCRIPTION_KEY: 'Clave de OpenAI (transcripción) no válida. Revísala en Ajustes.',
    INSUFFICIENT_CREDITS:
      'Créditos de OpenRouter insuficientes. Añade créditos en openrouter.ai/credits y vuelve a intentarlo.',
    RATE_LIMITED:
      'Demasiadas solicitudes (límite de frecuencia). Espera un momento y vuelve a intentarlo.',
    MODEL_UNAVAILABLE:
      'El modelo elegido no está disponible en OpenRouter. Elige otro modelo en Ajustes.',
    CONTEXT_TOO_LONG:
      'La transcripción es demasiado larga para el modelo elegido. Elige un modelo con mayor contexto en Ajustes.',
    MEDIA_NOT_CAPTURABLE:
      'No se pudo recuperar el flujo de vídeo. Puede que este proveedor no sea compatible.',
    MEDIA_NEEDS_PLAYBACK:
      'Reproduce el vídeo unos segundos y vuelve a intentarlo — el flujo debe cargarse primero.',
    MEDIA_PROTECTED:
      'Acceso denegado por el servidor de vídeo. Vuelve a reproducir el vídeo y vuelve a intentarlo. Los vídeos protegidos con DRM no son compatibles.',
    MEDIA_TOO_LARGE:
      'Este vídeo es demasiado grande para procesarlo en memoria. Prueba con uno más corto.',
    AUDIO_EXTRACTION_FAILED: 'No se pudo aislar la pista de audio.',
    TRANSCRIPTION_API_ERROR: 'El servicio de transcripción devolvió un error.',
    TIMEOUT: 'El procesamiento superó el tiempo límite. Prueba con un vídeo más corto.',
    UNSUPPORTED_PROVIDER: 'Este proveedor aún no es compatible.',
    SUMMARY_API_ERROR: 'No se pudo generar el resumen. Vuelve a intentarlo.',
    CANCELLED: 'Cancelado.',
    INTERRUPTED:
      'Interrumpido: la extensión se reinició en segundo plano. Vuelve a generar el resumen.',
    UNKNOWN: 'Se produjo un error inesperado.',
  },
  onboarding: {
    next: 'Siguiente',
    back: 'Atrás',
    skip: 'Omitir',
    finish: 'Empezar',
    getStarted: 'Empezar',
    welcomeTitle: 'Bienvenido a tldw',
    welcomeBody:
      'Convierte los vídeos de una página en resúmenes claros y estructurados que se leen en un minuto — YouTube, Vimeo o cualquier vídeo. Configurémoslo en 30 segundos.',
    langTitle: 'Tus idiomas',
    langBody: 'Elige el idioma de la extensión y el idioma en que se escribirán tus resúmenes.',
    themeTitle: 'Elige el aspecto',
    themeBody: 'Sigue tu sistema, o fuerza el modo claro u oscuro.',
    keyTitle: 'Conecta OpenRouter',
    keyBody:
      'tldw usa tu propia clave de OpenRouter para generar los resúmenes — una cuenta, sin suscripción, pagas solo lo que usas.',
    keyCost:
      'Un resumen cuesta aproximadamente un céntimo o menos con subtítulos, y unos 5–10 céntimos para un vídeo de 1 hora transcrito desde el audio. Tu clave se queda en tu dispositivo.',
    keyGet: 'Consigue una clave gratis ↗',
    keyPlaceholder: 'Pega tu clave de OpenRouter (sk-or-…)',
    keyLater: 'Puedes añadirla más tarde en Ajustes.',
    doneTitle: 'Todo listo 🎉',
    doneBody:
      'Abre una página con un vídeo y haz clic en el icono de tldw. Puedes cambiar todo cuando quieras en Ajustes.',
  },
};
