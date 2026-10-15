import { describe, it, expect, vi, afterEach } from 'vitest';
import { bytesToBase64, transcribeViaOpenRouter } from './openrouter-audio';

afterEach(() => {
  vi.unstubAllGlobals();
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

    await expect(transcribeViaOpenRouter(bytes, options)).resolves.toBe('hello');
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

    await expect(transcribeViaOpenRouter(bytes, options)).resolves.toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a network error then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse('hello'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).resolves.toBe('hello');
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

  it('fails without retry on 401/403', async () => {
    for (const status of [401, 403]) {
      const fetchMock = vi.fn().mockResolvedValue(new Response('denied', { status }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(transcribeViaOpenRouter(bytes, options)).rejects.toMatchObject({
        code: 'TRANSCRIPTION_API_ERROR',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }
  });

  it('fails immediately with QUOTA_EXCEEDED on 402 (out of credits)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('no credits', { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
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

  it('throws QUOTA_EXCEEDED after exhausting retries on 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(transcribeViaOpenRouter(bytes, options)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
