import type { TldwErrorCode } from '@/types';

/**
 * Maps an OpenRouter / OpenAI HTTP failure to an actionable error code —
 * shared by the summarizer (worker) and the audio transcription clients
 * (offscreen), so the same provider answer means the same thing everywhere.
 * `fallback` is the code for anything not recognized (the caller's own
 * "service returned an error").
 */
export function classifyHttpError(
  status: number,
  body: string,
  fallback: TldwErrorCode = 'SUMMARY_API_ERROR',
): TldwErrorCode {
  if (status === 401 || status === 403) return 'INVALID_API_KEY';
  if (status === 402) return 'INSUFFICIENT_CREDITS';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 404) return 'MODEL_UNAVAILABLE';
  if (status === 400) {
    if (/context|too long|too many tokens|maximum.*tokens|token limit/i.test(body)) {
      return 'CONTEXT_TOO_LONG';
    }
    // The provider rejects the response format (json_schema / structured
    // outputs): not a model problem, the caller can retry with json_object.
    if (isResponseFormatError(body)) return fallback;
    // The chosen model cannot take this request at all: no provider serves
    // it, or it does not accept audio input.
    if (
      /no endpoints found|does not support (?:input )?audio|audio (?:input )?(?:is )?not supported/i.test(
        body,
      )
    ) {
      return 'MODEL_UNAVAILABLE';
    }
    if (
      /model/i.test(body) &&
      /invalid|not a valid|unavailable|not found|does not exist|not supported/i.test(body)
    ) {
      return 'MODEL_UNAVAILABLE';
    }
  }
  return fallback;
}

/** True when a 400 body complains about response_format / json_schema / structured outputs. */
export function isResponseFormatError(body: string): boolean {
  return /response_format|json_schema|structured[ _-]?outputs?/i.test(body);
}
