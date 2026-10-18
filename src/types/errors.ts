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
  | 'MEDIA_TOO_LARGE'
  | 'AUDIO_EXTRACTION_FAILED'
  | 'TRANSCRIPTION_API_ERROR'
  | 'TIMEOUT'
  // Detection
  | 'NO_VIDEO_DETECTED'
  | 'UNSUPPORTED_PROVIDER'
  // Job lifecycle
  | 'INTERRUPTED'
  /** Stopped by the user — a neutral outcome, not a failure. */
  | 'CANCELLED'
  // Summarizer / config
  | 'MISSING_OPENROUTER_KEY'
  | 'MISSING_TRANSCRIPTION_KEY'
  | 'SUMMARY_API_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_API_KEY'
  /** The OpenAI key used for Whisper transcription was rejected (401/403). */
  | 'INVALID_TRANSCRIPTION_KEY'
  | 'INSUFFICIENT_CREDITS'
  | 'RATE_LIMITED'
  | 'MODEL_UNAVAILABLE'
  | 'CONTEXT_TOO_LONG'
  // Catch-all
  | 'UNKNOWN';

export class TldwError extends Error {
  readonly code: TldwErrorCode;
  /** Raw provider message, shown verbatim when relevant (e.g. quota errors). */
  readonly providerMessage?: string;
  /** Seconds to wait before retrying (RATE_LIMITED), when the provider says so. */
  readonly retryAfter?: number;

  constructor(code: TldwErrorCode, message: string, providerMessage?: string, retryAfter?: number) {
    super(message);
    this.name = 'TldwError';
    this.code = code;
    this.providerMessage = providerMessage;
    this.retryAfter = retryAfter;
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
  INVALID_API_KEY: 'OpenRouter rejected the API key. Check your API key in Settings.',
  INVALID_TRANSCRIPTION_KEY:
    'OpenAI rejected the transcription (Whisper) key. Check it in Settings.',
  INSUFFICIENT_CREDITS:
    'Not enough OpenRouter credits. Add credits at https://openrouter.ai/credits, then retry.',
  RATE_LIMITED: 'Too many requests (rate limit). Wait a moment, then retry.',
  MODEL_UNAVAILABLE:
    'The selected model is unavailable on OpenRouter. Choose another model in Settings.',
  CONTEXT_TOO_LONG:
    'The transcript is too long for the selected model. Choose a model with a larger context in Settings.',
  MEDIA_NOT_CAPTURABLE: 'The video stream could not be retrieved. This host may not be supported.',
  MEDIA_NEEDS_PLAYBACK:
    'Play the video for a few seconds, then try again — the media stream needs to load first.',
  MEDIA_PROTECTED:
    'Access denied by the video server. Play the video again, then retry. DRM-protected videos are not supported.',
  MEDIA_TOO_LARGE: 'The video is too large to process in memory. Try a shorter video.',
  AUDIO_EXTRACTION_FAILED: 'Isolating the audio track failed.',
  TRANSCRIPTION_API_ERROR: 'The transcription service returned an error.',
  TIMEOUT: 'Processing exceeded the time limit. Try a shorter video.',
  UNSUPPORTED_PROVIDER: 'This host is not supported yet.',
  SUMMARY_API_ERROR: 'Generating the summary failed. Try again.',
  CANCELLED: 'Cancelled.',
  INTERRUPTED: 'Interrupted — the extension worker was restarted. You can relaunch it.',
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
