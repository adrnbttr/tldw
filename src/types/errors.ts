/**
 * Typed error codes (spec §3.5, §4).
 *
 * Principle: no silent failure. Every error carries a code so the UI can tell the
 * user what was attempted, what failed, and what they can do about it.
 */
export type TldwErrorCode =
  // Extraction — captions
  | 'NO_CAPTIONS_AVAILABLE'
  // Extraction — audio fallback
  | 'MEDIA_NOT_CAPTURABLE'
  | 'MEDIA_PROTECTED'
  | 'AUDIO_EXTRACTION_FAILED'
  | 'TRANSCRIPTION_API_ERROR'
  | 'TIMEOUT'
  // Detection
  | 'NO_VIDEO_DETECTED'
  | 'UNSUPPORTED_PROVIDER'
  // Summarizer / config
  | 'MISSING_OPENROUTER_KEY'
  | 'MISSING_TRANSCRIPTION_KEY'
  | 'SUMMARY_API_ERROR'
  | 'QUOTA_EXCEEDED'
  // Catch-all
  | 'UNKNOWN';

export class TldwError extends Error {
  readonly code: TldwErrorCode;
  /** Raw provider message, shown verbatim when relevant (e.g. quota errors). */
  readonly providerMessage?: string;

  constructor(code: TldwErrorCode, message: string, providerMessage?: string) {
    super(message);
    this.name = 'TldwError';
    this.code = code;
    this.providerMessage = providerMessage;
  }
}

/** User-facing messages (French UI), mapped from error codes (spec §4). */
export const ERROR_MESSAGES: Record<TldwErrorCode, string> = {
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
};

export function messageFor(error: unknown): string {
  if (error instanceof TldwError) {
    return error.providerMessage
      ? `${ERROR_MESSAGES[error.code]} (${error.providerMessage})`
      : ERROR_MESSAGES[error.code];
  }
  return ERROR_MESSAGES.UNKNOWN;
}
