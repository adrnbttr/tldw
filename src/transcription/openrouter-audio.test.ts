import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MAX_RETRY_AFTER_MS,
  bytesToBase64,
  parseRetryAfter,
  transcribeViaOpenRouter,
} from './openrouter-audio';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bytesToBase64', () => {
  it('encodes bytes like the standard base64', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(bytesToBase64(bytes)).toBe('aGVsbG8=');
  });

  it('handles binary bytes across the chunk boundary', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    const b64 = bytesToBase64(bytes);
    // Round-trips back to the same bytes.
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded[0]).toBe(0);
    expect(decoded[69_999]).toBe(69_999 % 256);
  });
});

describe('transcribeViaOpenRouter', () => {
  // Injected for tests: 3 attempts, zero backoff delay.
  const options = {
    apiKey: 'key',
    model: 'google/gemini-2.5-flash',
    maxAttempts: 3,
    retryDelayMs: 0,
  };

  const okResponse = (text: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content: ` ${text} ` } }] }), {
      status: 200,
    });

  const bytes = new Uint8Array(4);

  it('retries a 5xx then succeeds, with an explicit max_tokens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(okResponse('hello'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).resolves.toEqual({
      text: 'hello',
      truncated: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = String(fetchMock.mock.calls[0][1]?.body);
    expect(body).toContain('"max_tokens"');
  });

  it('retries a 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(okResponse('hello'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).resolves.toEqual({
      text: 'hello',
      truncated: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network error then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse('hello'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).resolves.toEqual({
      text: 'hello',
      truncated: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a plain 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).rejects.toMatchObject({
      code: 'TRANSCRIPTION_API_ERROR',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails without retry on 401/403 with INVALID_API_KEY', async () => {
    for (const status of [401, 403]) {
      const fetchMock = vi.fn().mockResolvedValue(new Response('denied', { status }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(transcribeViaOpenRouter(bytes, options)).rejects.toMatchObject({
        code: 'INVALID_API_KEY',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }
  });

  it('fails immediately with INSUFFICIENT_CREDITS on 402 (out of credits)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('no credits', { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws the typed error when attempts are exhausted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).rejects.toMatchObject({
      code: 'TRANSCRIPTION_API_ERROR',
      message: 'OpenRouter returned 503.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws RATE_LIMITED (not a quota error) after exhausting retries on 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('honors a 429 Retry-After (seconds) before retrying', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } }),
      )
      .mockResolvedValueOnce(okResponse('hello'));
    vi.stubGlobal('fetch', fetchMock);

    const p = transcribeViaOpenRouter(bytes, options);
    await vi.advanceTimersByTimeAsync(6_900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toEqual({ text: 'hello', truncated: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts a Retry-After wait as soon as the job is cancelled', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const p = transcribeViaOpenRouter(bytes, { ...options, signal: controller.signal });
    const settled = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats empty content as an empty chunk, not an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('   '));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).resolves.toEqual({
      text: '',
      truncated: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flags a response cut by the output cap (finish_reason 'length')", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'partial' }, finish_reason: 'length' }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).resolves.toEqual({
      text: 'partial',
      truncated: true,
    });
  });

  it('asks for the spoken language, never a translation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('hola'));
    vi.stubGlobal('fetch', fetchMock);

    await transcribeViaOpenRouter(bytes, options);
    const body = String(fetchMock.mock.calls[0][1]?.body);
    expect(body).toContain('do not translate');
  });

  it('requires an API key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, { ...options, apiKey: '' })).rejects.toMatchObject({
      code: 'MISSING_OPENROUTER_KEY',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds and HTTP-dates, capped', () => {
    const now = Date.parse('2026-10-18T10:00:00Z');
    expect(parseRetryAfter('5', now)).toBe(5000);
    expect(parseRetryAfter('Sun, 18 Oct 2026 10:00:20 GMT', now)).toBe(20_000);
    expect(parseRetryAfter('3600', now)).toBe(MAX_RETRY_AFTER_MS);
    expect(parseRetryAfter('Sun, 18 Oct 2026 09:00:00 GMT', now)).toBe(0);
  });

  it('returns null for absent or garbage values', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('audio model errors (shared classifier)', () => {
  const opts = { apiKey: 'k', model: 'x', maxAttempts: 2, retryDelayMs: 0 };
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [404, '{"error":{"message":"No endpoints found for google/gemini-2.5-flash"}}'],
    [400, '{"error":{"message":"No endpoints found that support input audio"}}'],
    [400, '{"error":{"message":"This model does not support audio input"}}'],
  ])('%i %s → MODEL_UNAVAILABLE, not retried', async (status, body) => {
    const f = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal('fetch', f);
    await expect(transcribeViaOpenRouter(new Uint8Array(4), opts)).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
    });
    expect(f).toHaveBeenCalledOnce();
  });
});
