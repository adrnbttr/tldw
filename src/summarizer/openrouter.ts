import { TldwError } from '@/types';

/**
 * Minimal OpenRouter chat client (F7).
 *
 * Called directly from the extension with the user's key. No backend, no proxy.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** Ask the provider to return a JSON object when the model supports it. */
  jsonMode?: boolean;
  temperature?: number;
  signal?: AbortSignal;
}

export async function chat(options: ChatOptions): Promise<string> {
  const { apiKey, model, messages, jsonMode, temperature = 0.3, signal } = options;

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
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new TldwError('TIMEOUT', 'Summary request aborted.');
    throw new TldwError('SUMMARY_API_ERROR', 'Network error calling OpenRouter.', String(err));
  }

  if (response.status === 429) {
    const body = await safeText(response);
    throw new TldwError('QUOTA_EXCEEDED', 'OpenRouter quota exceeded.', body);
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
