/**
 * Typed error codes (spec §3.5, §4).
 *
 * Principle: no silent failure. Every error carries a code so the UI can tell the
 * user what was attempted, what failed, and what they can do about it.
 */
export type TldwErrorCode =
  // Extraction — captions
  | 'NO_CAPTIONS_AVAILABLE'
  | 'CAPTIONS_BLOCKED'
  // Extraction — audio fallback
  | 'MEDIA_NOT_CAPTURABLE'
  | 'MEDIA_NEEDS_PLAYBACK'
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

/**
 * Neutral (English) fallback messages, mapped from error codes (spec §4). The
 * localized user-facing strings live in the i18n catalogs; these are the internal
 * default carried on `JobState.message` for logging and non-UI contexts.
 */
export const ERROR_MESSAGES: Record<TldwErrorCode, string> = {
  NO_VIDEO_DETECTED: 'No video found on this page. Start playback, then try again.',
  NO_CAPTIONS_AVAILABLE:
    'This video has no captions and audio transcription is not configured. Add a transcription key in the settings.',
  CAPTIONS_BLOCKED:
    'YouTube is currently blocking caption downloads for this video (a YouTube anti-bot restriction, not a tldw bug).',
  MISSING_OPENROUTER_KEY: 'OpenRouter key missing. Add it in the settings.',
  MISSING_TRANSCRIPTION_KEY:
    'Transcription key missing. Add it in the settings to enable the audio fallback.',
  QUOTA_EXCEEDED: 'API quota exceeded.',
  MEDIA_NOT_CAPTURABLE: 'The video stream could not be retrieved. This host may not be supported.',
  MEDIA_NEEDS_PLAYBACK:
    'Play the video for a few seconds, then try again — the media stream needs to load first.',
  MEDIA_PROTECTED: 'The content is protected (encrypted). Audio transcription cannot be performed.',
  AUDIO_EXTRACTION_FAILED: 'Isolating the audio track failed.',
  TRANSCRIPTION_API_ERROR: 'The transcription service returned an error.',
  TIMEOUT: 'Processing exceeded the time limit. Try a shorter video.',
  UNSUPPORTED_PROVIDER: 'This host is not supported yet.',
  SUMMARY_API_ERROR: 'Generating the summary failed.',
  UNKNOWN: 'An unexpected error occurred.',
};

export function messageFor(error: unknown): string {
  if (error instanceof TldwError) {
    return error.providerMessage
      ? `${ERROR_MESSAGES[error.code]} (${error.providerMessage})`
      : ERROR_MESSAGES[error.code];
  }
  return ERROR_MESSAGES.UNKNOWN;
}
