import { TldwError } from '@/types';

/**
 * Audio transcription via OpenRouter (F5, level 2 — default backend).
 *
 * Instead of a separate Whisper account, the extracted audio is sent as an
 * `input_audio` content part to a multimodal model (Gemini). This means the user
 * pays a single provider — their OpenRouter key covers both summary and audio.
 * Returns plain transcript text (no per-segment timings).
 *
 * Each chunk request is bounded (explicit max_tokens, per-attempt timeout) and
 * retried with exponential backoff on transient failures (429/5xx/network).
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Output cap: ~12 min of verbatim speech stays well under this. */
const MAX_TOKENS = 8192;
/** Wall-clock budget for one chunk attempt before aborting it. */
const CHUNK_TIMEOUT_MS = 5 * 60 * 1000;

export interface OpenRouterAudioOptions {
  apiKey: string;
  /** Multimodal OpenRouter model id, e.g. "google/gemini-2.5-flash". */
  model: string;
  /** BCP-47 language hint. */
  language?: string;
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

type AttemptResult =
  { ok: true; text: string } | { ok: false; retryable: boolean; error: TldwError };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

    if (response.ok) {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      return text
        ? { ok: true, text }
        : {
            ok: false,
            retryable: false,
            error: new TldwError(
              'TRANSCRIPTION_API_ERROR',
              'OpenRouter returned an empty transcript.',
            ),
          };
    }

    const body = await response.text().catch(() => '');
    // Retry transient failures only: 429 (rate limit) and 5xx — never 401/403
    // or other 4xx, and 402 (out of credits) is permanent.
    const retryable = response.status === 429 || response.status >= 500;
    const error =
      response.status === 429 || response.status === 402
        ? new TldwError(
            'QUOTA_EXCEEDED',
            'OpenRouter quota/credits exceeded.',
            body.slice(0, 300) || undefined,
          )
        : new TldwError(
            'TRANSCRIPTION_API_ERROR',
            `OpenRouter returned ${response.status}.`,
            body.slice(0, 300),
          );
    return { ok: false, retryable, error };
  } catch (err) {
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

export async function transcribeViaOpenRouter(
  audio: Uint8Array,
  options: OpenRouterAudioOptions,
): Promise<string> {
  const { apiKey, model, language, signal, maxAttempts = 4, retryDelayMs = 1000 } = options;
  if (!apiKey) {
    throw new TldwError('MISSING_OPENROUTER_KEY', 'OpenRouter API key is missing.');
  }

  const instruction = language
    ? `Transcribe this audio verbatim in ${language}. Output only the transcript text, no commentary.`
    : 'Transcribe this audio verbatim. Output only the transcript text, no commentary.';

  const audioBase64 = bytesToBase64(audio);
  const attempts = Math.max(1, Math.floor(maxAttempts));

  for (let attempt = 1; ; attempt++) {
    const outcome = await requestChunk({ apiKey, model, instruction, audioBase64, signal });
    if (outcome.ok) return outcome.text;
    if (!outcome.retryable || attempt >= attempts) throw outcome.error;
    await sleep(retryDelayMs * 2 ** (attempt - 1));
  }
}
