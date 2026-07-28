import type { Messages } from './types';

export const es: Messages = {
  list: {
    historyTooltip: 'Historial',
    settingsTooltip: 'Ajustes',
    emptyTitle: 'No se encontró ningún vídeo en esta página.',
    emptyHint: 'Inicia la reproducción y vuelve a abrir este menú.',
    noTitle: 'Vídeo sin título',
    videoLabel: 'Vídeo',
    untreatable: 'no compatible',
    summarize: 'Resumir',
    summarizeSelection: (count) => `Resumir la selección (${count})`,
  },
  transcription: {
    fetchingMedia: 'Recuperando el flujo multimedia…',
    extractingAudio: 'Extrayendo la pista de audio…',
    assembling: (index, total) => `Ensamblando segmentos (${index}/${total})…`,
    transcribing: (index, total, clock) => `Transcribiendo ${index}/${total} (${clock})…`,
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
    failedTitle: 'Error',
    backToList: 'Volver a la lista',
    cancel: 'Cancelar',
  },
  result: {
    back: '← Atrás',
    heading: 'Resumen',
    method: (source) => `Método: ${source}`,
    download: 'Descargar (.md)',
    copy: 'Copiar',
    copied: 'Copiado ✓',
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
    outputLanguage: 'Idioma del resumen',
    uiLanguage: 'Idioma de la interfaz',
    detailLevel: 'Nivel de detalle',
    detailLevels: { concise: 'Conciso', standard: 'Estándar', detailed: 'Detallado' },
    template: 'Plantilla de resumen',
    save: 'Guardar',
    saved: 'Guardado ✓',
  },
  history: {
    back: '← Atrás',
    heading: 'Historial',
    empty: 'Aún no hay ningún resumen guardado.',
  },
  batch: {
    back: '← Atrás',
    heading: 'Procesamiento por lotes',
    progress: (completed, total) => `${completed} / ${total} procesados`,
    current: (title) => `En curso: ${title}`,
    downloadAll: (count) => `Descargar todo (${count}) en un archivo .md`,
  },
  sources: {
    youtube_captions: 'Subtítulos de YouTube',
    vimeo_captions: 'Subtítulos de Vimeo',
    audio_transcription: 'Transcripción de audio',
  },
  errors: {
    NO_VIDEO_DETECTED:
      'No se encontró ningún vídeo en esta página. Inicia la reproducción e inténtalo de nuevo.',
    NO_CAPTIONS_AVAILABLE:
      'Este vídeo no tiene subtítulos y la transcripción de audio no está configurada. Añade una clave de transcripción en los ajustes.',
    MISSING_OPENROUTER_KEY: 'Falta la clave de OpenRouter. Añádela en los ajustes.',
    MISSING_TRANSCRIPTION_KEY:
      'Falta la clave de transcripción. Añádela en los ajustes para activar el respaldo de audio.',
    QUOTA_EXCEEDED: 'Cuota de la API superada.',
    MEDIA_NOT_CAPTURABLE:
      'No se pudo recuperar el flujo de vídeo. Puede que este proveedor no sea compatible.',
    MEDIA_PROTECTED:
      'El contenido está protegido (cifrado). No se puede realizar la transcripción de audio.',
    AUDIO_EXTRACTION_FAILED: 'No se pudo aislar la pista de audio.',
    TRANSCRIPTION_API_ERROR: 'El servicio de transcripción devolvió un error.',
    TIMEOUT: 'El procesamiento superó el tiempo límite. Prueba con un vídeo más corto.',
    UNSUPPORTED_PROVIDER: 'Este proveedor aún no es compatible.',
    SUMMARY_API_ERROR: 'No se pudo generar el resumen.',
    UNKNOWN: 'Se produjo un error inesperado.',
  },
};
