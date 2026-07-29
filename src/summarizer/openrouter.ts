import { TldwError } from '@/types';

/**
 * Minimal OpenRouter chat client (F7).
 *
 * Called directly from the extension with the user's key. No backend, no proxy.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** A multimodal content part (text, or a video URL — e.g. a YouTube link). */
export type ContentPart =
  { type: 'text'; text: string } | { type: 'video_url'; video_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** Ask the provider to return a JSON object when the model supports it. */
  jsonMode?: boolean;
  temperature?: number;
  /** OpenRouter provider routing (e.g. force Google AI Studio for YouTube URLs). */
  provider?: Record<string, unknown>;
  signal?: AbortSignal;
}

export async function chat(options: ChatOptions): Promise<string> {
  const { apiKey, model, messages, jsonMode, temperature = 0.3, provider, signal } = options;

  if (!apiKey) {
    throw new TldwError('MISSING_OPENROUTER_KEY', 'OpenRouter API key is missing.');
  }

  let response: globalThis.Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Optional attribution headers accepted by OpenRouter.
        'HTTP-Referer': 'https://github.com/adrnbttr/tldw',
        'X-Title': 'tldw',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        ...(provider ? { provider } : {}),
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new TldwError('TIMEOUT', 'Summary request aborted.');
    throw new TldwError('SUMMARY_API_ERROR', 'Network error calling OpenRouter.', String(err));
  }

  if (response.status === 429 || response.status === 402) {
    const body = await safeText(response);
    const retry = response.headers.get('retry-after');
    const hint = retry ? `réessayez dans ${retry}s. ${body}` : body;
    throw new TldwError('QUOTA_EXCEEDED', 'OpenRouter quota/credits exceeded.', hint.trim());
  }
  if (!response.ok) {
    const body = await safeText(response);
    throw new TldwError('SUMMARY_API_ERROR', `OpenRouter returned ${response.status}.`, body);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new TldwError('SUMMARY_API_ERROR', 'OpenRouter returned an empty response.');
  }
  return content;
}

async function safeText(response: globalThis.Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}
