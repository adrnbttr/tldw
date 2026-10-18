import type { TranscriptSegment } from '@/types';
import { TldwError } from '@/types';
import { classifyHttpError } from '@/shared/http-error';
import { parseRetryAfter, sleep } from './openrouter-audio';

/**
 * Whisper transcription client (F5.5).
 *
 * Targets the OpenAI-compatible `audio/transcriptions` endpoint. Requesting
 * `verbose_json` gives per-segment timings, which we need to reassemble chunks.
 *
 * Same failure policy as the OpenRouter audio client: transient failures
 * (5xx, network, 429 after its `Retry-After`, capped at 60 s) are retried with
 * exponential backoff and an abortable wait; everything else is typed by the
 * shared classifier (src/shared/http-error.ts).
 */

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

export interface WhisperOptions {
  apiKey: string;
  /** Model id, e.g. "whisper-1". */
  model?: string;
  /** BCP-47 language hint to improve accuracy. */
  language?: string;
  signal?: AbortSignal;
  /** Total attempts per window, including the first (default 4). */
  maxAttempts?: number;
  /** Base backoff delay in ms, doubled after each failed attempt (default 1000). */
  retryDelayMs?: number;
}

interface VerboseJson {
  text?: string;
  language?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface WhisperResult {
  language: string;
  segments: TranscriptSegment[];
}

type Attempt =
  | { ok: true; data: VerboseJson }
  | { ok: false; retryable: boolean; error: TldwError; retryAfterMs?: number };

/** One HTTP attempt; never throws, always reports the outcome. */
async function attempt(form: FormData, apiKey: string, signal?: AbortSignal): Promise<Attempt> {
  let response: globalThis.Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) {
      return {
        ok: false,
        retryable: false,
        error: new TldwError('TIMEOUT', 'Transcription aborted.'),
      };
    }
    return {
      ok: false,
      retryable: true,
      error: new TldwError(
        'TRANSCRIPTION_API_ERROR',
        'Network error calling Whisper.',
        String(err),
      ),
    };
  }

  if (response.ok) return { ok: true, data: (await response.json()) as VerboseJson };

  const body = await response.text().catch(() => '');
  const detail = body.slice(0, 300) || undefined;
  if (response.status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after')) ?? undefined;
    return {
      ok: false,
      retryable: true,
      retryAfterMs,
      error: new TldwError(
        'RATE_LIMITED',
        'Transcription rate limit reached (429).',
        detail,
        retryAfterMs != null ? Math.ceil(retryAfterMs / 1000) : undefined,
      ),
    };
  }
  // 401/403 here is the OpenAI key, not the OpenRouter one the shared
  // classifier names: a distinct code points the user to the right field.
  const code =
    response.status === 401 || response.status === 403
      ? 'INVALID_TRANSCRIPTION_KEY'
      : classifyHttpError(response.status, body, 'TRANSCRIPTION_API_ERROR');
  return {
    ok: false,
    retryable: response.status >= 500,
    error: new TldwError(code, `Whisper returned ${response.status}.`, detail),
  };
}

export async function transcribeAudio(
  audio: Blob,
  filename: string,
  options: WhisperOptions,
): Promise<WhisperResult> {
  const {
    apiKey,
    model = 'whisper-1',
    language,
    signal,
    maxAttempts = 4,
    retryDelayMs = 1000,
  } = options;
  if (!apiKey) {
    throw new TldwError('MISSING_TRANSCRIPTION_KEY', 'Transcription API key is missing.');
  }

  const form = new FormData();
  form.append('file', audio, filename);
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  if (language) form.append('language', language);

  const attempts = Math.max(1, Math.floor(maxAttempts));
  let data: VerboseJson;
  for (let n = 1; ; n++) {
    const outcome = await attempt(form, apiKey, signal);
    if (outcome.ok) {
      data = outcome.data;
      break;
    }
    if (!outcome.retryable || n >= attempts) throw outcome.error;
    await sleep(outcome.retryAfterMs ?? retryDelayMs * 2 ** (n - 1), signal);
  }

  const segments: TranscriptSegment[] = (data.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));

  // Detected spoken language; '' when unknown (never a guessed default).
  return { language: data.language ?? language ?? '', segments };
}
