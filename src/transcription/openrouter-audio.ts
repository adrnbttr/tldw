import { TldwError } from '@/types';

/**
 * Audio transcription via OpenRouter (F5, level 2 — default backend).
 *
 * Instead of a separate Whisper account, the extracted audio is sent as an
 * `input_audio` content part to a multimodal model (Gemini). This means the user
 * pays a single provider — their OpenRouter key covers both summary and audio.
 * Returns plain transcript text (no per-segment timings).
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterAudioOptions {
  apiKey: string;
  /** Multimodal OpenRouter model id, e.g. "google/gemini-2.5-flash". */
  model: string;
  /** BCP-47 language hint. */
  language?: string;
  signal?: AbortSignal;
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

export async function transcribeViaOpenRouter(
  audio: Uint8Array,
  options: OpenRouterAudioOptions,
): Promise<string> {
  const { apiKey, model, language, signal } = options;
  if (!apiKey) {
    throw new TldwError('MISSING_OPENROUTER_KEY', 'OpenRouter API key is missing.');
  }

  const instruction = language
    ? `Transcribe this audio verbatim in ${language}. Output only the transcript text, no commentary.`
    : 'Transcribe this audio verbatim. Output only the transcript text, no commentary.';

  let response: globalThis.Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/adrnbttr/tldw',
        'X-Title': 'tldw',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              { type: 'input_audio', input_audio: { data: bytesToBase64(audio), format: 'mp3' } },
            ],
          },
        ],
        temperature: 0,
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new TldwError('TIMEOUT', 'Transcription aborted.');
    throw new TldwError(
      'TRANSCRIPTION_API_ERROR',
      'Network error calling OpenRouter.',
      String(err),
    );
  }

  if (response.status === 429 || response.status === 402) {
    const retry = response.headers.get('retry-after');
    throw new TldwError(
      'QUOTA_EXCEEDED',
      'OpenRouter quota/credits exceeded.',
      retry ? `retry after ${retry}s` : undefined,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new TldwError(
      'TRANSCRIPTION_API_ERROR',
      `OpenRouter returned ${response.status}.`,
      body.slice(0, 300),
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new TldwError('TRANSCRIPTION_API_ERROR', 'OpenRouter returned an empty transcript.');
  }
  return text;
}
