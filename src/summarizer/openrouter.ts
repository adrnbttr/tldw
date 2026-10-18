import { TldwError } from '@/types';
import { log } from '@/background/log';
import { classifyHttpError, isResponseFormatError } from '@/shared/http-error';

/**
 * Minimal OpenRouter chat client (F7).
 *
 * Called directly from the extension with the user's key. No backend, no proxy.
 * Runs in the service worker, so it logs through the worker's own logger:
 * model, HTTP status and response size only — never the Authorization header,
 * the request body, or the key.
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
  /** Strict JSON schema output (takes precedence over jsonMode). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  temperature?: number;
  /** OpenRouter provider routing (e.g. force Google AI Studio for YouTube URLs). */
  provider?: Record<string, unknown>;
  signal?: AbortSignal;
}

/** Models whose provider rejected strict json_schema: use json_object from now on. */
const schemaRejected = new Set<string>();

/** Test hook: forget the models remembered as rejecting json_schema. */
export function resetSchemaFallback(): void {
  schemaRejected.clear();
}

/** A 400 caused by the response_format: carries the error to throw if the retry is not possible. */
class SchemaRejectedError extends TldwError {}

export async function chat(options: ChatOptions): Promise<string> {
  const { jsonSchema, model } = options;
  if (jsonSchema && schemaRejected.has(model)) {
    return chatOnce({ ...options, jsonSchema: undefined, jsonMode: true });
  }
  try {
    return await chatOnce(options);
  } catch (err) {
    if (jsonSchema && err instanceof SchemaRejectedError) {
      schemaRejected.add(model);
      log.warn('json_schema rejected, retrying with json_object', { model });
      return chatOnce({ ...options, jsonSchema: undefined, jsonMode: true });
    }
    throw err;
  }
}

async function chatOnce(options: ChatOptions): Promise<string> {
  const {
    apiKey,
    model,
    messages,
    jsonMode,
    jsonSchema,
    temperature = 0.3,
    provider,
    signal,
  } = options;

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
        ...(jsonSchema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema },
              },
            }
          : jsonMode
            ? { response_format: { type: 'json_object' } }
            : {}),
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new TldwError('CANCELLED', 'Summary request aborted.');
    log.warn('openrouter request failed', { model, error: String(err) });
    throw new TldwError('SUMMARY_API_ERROR', 'Network error calling OpenRouter.', String(err));
  }

  if (!response.ok) {
    const body = await safeText(response);
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    const code = classifyHttpError(response.status, body);
    if (response.status === 400 && jsonSchema && isResponseFormatError(body)) {
      throw new SchemaRejectedError(code, `OpenRouter returned 400.`, body.trim() || undefined);
    }
    log.warn('openrouter api error', { model, status: response.status, code, retryAfter });
    throw new TldwError(
      code,
      `OpenRouter returned ${response.status}.`,
      body.trim() || undefined,
      retryAfter,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    log.warn('openrouter empty response', { model, status: response.status });
    throw new TldwError('SUMMARY_API_ERROR', 'OpenRouter returned an empty response.');
  }
  log.debug('openrouter response', {
    model,
    status: response.status,
    chars: content.length,
  });
  return content;
}

async function safeText(response: globalThis.Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}

/** Maps an OpenRouter HTTP failure to an actionable error code (shared with the audio clients). */
export { classifyHttpError };

/** Retry-After in seconds (numeric form, or an HTTP date); undefined if absent/invalid. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}
