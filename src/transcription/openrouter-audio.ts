import { TldwError } from '@/types';
import { createClientLogger } from '@/shared/logger-client';
import { classifyHttpError } from '@/shared/http-error';

/**
 * Audio transcription via OpenRouter (F5, level 2 — default backend).
 *
 * Instead of a separate Whisper account, the extracted audio is sent as an
 * `input_audio` content part to a multimodal model (Gemini). This means the user
 * pays a single provider — their OpenRouter key covers both summary and audio.
 * Returns plain transcript text (no per-segment timings).
 *
 * Each chunk request is bounded (explicit max_tokens, per-attempt timeout) and
 * retried on transient failures (5xx/network with exponential backoff; 429
 * after its `Retry-After`, capped at 60 s). Other failures are typed by the
 * shared classifier (src/shared/http-error.ts): 402 → INSUFFICIENT_CREDITS,
 * 404 / "no endpoints" / no audio support → MODEL_UNAVAILABLE, and an
 * exhausted 429 → RATE_LIMITED, so the user sees which one it is.
 */

/** Offscreen logger — ships to the worker's buffer and echoes to DevTools. */
const log = createClientLogger('offscreen', { echo: true });

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Output cap: ~12 min of verbatim speech stays well under this. */
const MAX_TOKENS = 8192;
/** Wall-clock budget for one chunk attempt before aborting it. */
const CHUNK_TIMEOUT_MS = 5 * 60 * 1000;
/** Longest wait honored from a 429 `Retry-After` header. */
export const MAX_RETRY_AFTER_MS = 60 * 1000;

export interface OpenRouterAudioOptions {
  apiKey: string;
  /** Multimodal OpenRouter model id, e.g. "google/gemini-2.5-flash". */
  model: string;
  // No language option: the model transcribes in the spoken language; asking
  // for the summary language would make it translate.
  signal?: AbortSignal;
  /** Total attempts per chunk, including the first (default 4). */
  maxAttempts?: number;
  /** Base backoff delay in ms, doubled after each failed attempt (default 1000). */
  retryDelayMs?: number;
}

/** Base64-encodes bytes in chunks to avoid call-stack limits on large audio. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** One chunk's transcript; `truncated` when the model hit the output cap. */
export interface ChunkTranscript {
  text: string;
  truncated: boolean;
}

type AttemptResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; retryable: boolean; error: TldwError; retryAfterMs?: number };

/**
 * Parses a `Retry-After` header — delta-seconds or an HTTP-date — into a
 * wait in ms, capped at `MAX_RETRY_AFTER_MS`. null when absent or unparsable.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  let ms: number;
  if (/^\d+$/.test(trimmed)) ms = Number(trimmed) * 1000;
  else {
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) return null;
    ms = at - now;
  }
  return Math.min(Math.max(0, ms), MAX_RETRY_AFTER_MS);
}

/** Waits `ms`, or rejects with a typed TIMEOUT as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => new TldwError('TIMEOUT', 'Transcription aborted.');
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** One timed HTTP attempt; never throws, always reports the outcome. */
async function requestChunk(request: {
  apiKey: string;
  model: string;
  instruction: string;
  audioBase64: string;
  signal?: AbortSignal;
}): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  request.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/adrnbttr/tldw',
        'X-Title': 'tldw',
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: request.instruction },
              {
                type: 'input_audio',
                input_audio: { data: request.audioBase64, format: 'mp3' },
              },
            ],
          },
        ],
        temperature: 0,
        max_tokens: MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    log.debug('openrouter response', { status: response.status });

    if (response.ok) {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
      };
      const choice = data.choices?.[0];
      if (!choice) {
        // A 200 without any choice is an upstream hiccup, not "silence".
        return {
          ok: false,
          retryable: true,
          error: new TldwError('TRANSCRIPTION_API_ERROR', 'OpenRouter returned no choice.'),
        };
      }
      // Empty content = a chunk without speech (music, silence): an empty
      // chunk, not a failure — the caller decides if *every* chunk was empty.
      const text = choice.message?.content?.trim() ?? '';
      const truncated = choice.finish_reason === 'length';
      if (truncated) log.warn('openrouter output truncated', { chars: text.length });
      return { ok: true, text, truncated };
    }

    const body = await response.text().catch(() => '');
    const detail = body.slice(0, 300) || undefined;
    if (response.status === 429) {
      // Rate limit — transient: retried, honoring Retry-After when given.
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after')) ?? undefined;
      return {
        ok: false,
        retryable: true,
        retryAfterMs,
        error: new TldwError(
          'RATE_LIMITED',
          'OpenRouter rate limit reached (429).',
          detail,
          retryAfterMs != null ? Math.ceil(retryAfterMs / 1000) : undefined,
        ),
      };
    }
    // Everything else is typed by the shared classifier; retry 5xx only —
    // never 401/403 or other 4xx.
    const code = classifyHttpError(response.status, body, 'TRANSCRIPTION_API_ERROR');
    return {
      ok: false,
      retryable: response.status >= 500,
      error: new TldwError(code, `OpenRouter returned ${response.status}.`, detail),
    };
  } catch (err) {
    log.warn('openrouter request failed', { error: String(err) });
    if (request.signal?.aborted) {
      return {
        ok: false,
        retryable: false,
        error: new TldwError('TIMEOUT', 'Transcription aborted.'),
      };
    }
    // Network failure or per-chunk timeout — both worth one more attempt.
    return {
      ok: false,
      retryable: true,
      error: new TldwError(
        'TRANSCRIPTION_API_ERROR',
        'Network error calling OpenRouter.',
        String(err),
      ),
    };
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Transcribes one audio chunk. Empty speech yields `text: ''`; a response cut
 * by the output cap (`finish_reason: 'length'`) comes back `truncated` so the
 * caller can retry on smaller pieces.
 */
export async function transcribeViaOpenRouter(
  audio: Uint8Array,
  options: OpenRouterAudioOptions,
): Promise<ChunkTranscript> {
  const { apiKey, model, signal, maxAttempts = 4, retryDelayMs = 1000 } = options;
  if (!apiKey) {
    throw new TldwError('MISSING_OPENROUTER_KEY', 'OpenRouter API key is missing.');
  }

  const instruction =
    'Transcribe this audio verbatim, in the language actually spoken — do not translate. ' +
    'Output only the transcript text, no commentary. If there is no speech, output nothing.';

  const audioBase64 = bytesToBase64(audio);
  const attempts = Math.max(1, Math.floor(maxAttempts));

  for (let attempt = 1; ; attempt++) {
    const outcome = await requestChunk({ apiKey, model, instruction, audioBase64, signal });
    if (outcome.ok) return { text: outcome.text, truncated: outcome.truncated };
    if (!outcome.retryable || attempt >= attempts) throw outcome.error;
    await sleep(outcome.retryAfterMs ?? retryDelayMs * 2 ** (attempt - 1), signal);
  }
}
