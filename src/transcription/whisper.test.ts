import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribeAudio } from './whisper';
import { fr } from '@/i18n/fr';
import { en } from '@/i18n/en';

afterEach(() => vi.unstubAllGlobals());

const call = (res: Response) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
  return transcribeAudio(new Blob(['x']), 'a.mp3', { apiKey: 'k', maxAttempts: 1 });
};

describe('whisper error mapping', () => {
  it.each([
    [401, 'INVALID_TRANSCRIPTION_KEY'],
    [403, 'INVALID_TRANSCRIPTION_KEY'],
    [402, 'INSUFFICIENT_CREDITS'],
    [500, 'TRANSCRIPTION_API_ERROR'],
  ])('maps %i to %s', async (status, code) => {
    await expect(call(new Response('x', { status }))).rejects.toMatchObject({ code });
  });

  it('a rejected OpenAI key is reported as such, not as the OpenRouter key', async () => {
    // Regression (v0.4.0 RC review): Whisper 401 showed « Clé API OpenRouter invalide ».
    const err = await call(
      new Response('{"error":{"message":"Incorrect API key"}}', { status: 401 }),
    )
      .then(() => null)
      .catch((e: { code: 'INVALID_TRANSCRIPTION_KEY' }) => e);
    expect(err?.code).toBe('INVALID_TRANSCRIPTION_KEY');
    for (const catalog of [fr, en]) {
      expect(catalog.errors.INVALID_TRANSCRIPTION_KEY).toMatch(/OpenAI/);
      expect(catalog.errors.INVALID_TRANSCRIPTION_KEY).not.toMatch(/OpenRouter/);
    }
  });

  it('maps 429 to RATE_LIMITED with retryAfter seconds', async () => {
    const res = new Response('slow', { status: 429, headers: { 'retry-after': '7' } });
    await expect(call(res)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfter: 7 });
  });
});

describe('whisper retries (same policy as OpenRouter audio)', () => {
  const verbose = () =>
    new Response(
      JSON.stringify({ language: 'en', segments: [{ start: 0, end: 1, text: ' hi ' }] }),
    );

  it('retries a transient 503 then succeeds', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(verbose());
    vi.stubGlobal('fetch', f);
    const out = await transcribeAudio(new Blob(['x']), 'a.mp3', { apiKey: 'k', retryDelayMs: 0 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(out.segments).toEqual([{ start: 0, end: 1, text: 'hi' }]);
  });

  it('honors Retry-After on 429 before retrying', async () => {
    vi.useFakeTimers();
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow', { status: 429, headers: { 'retry-after': '3' } }))
      .mockResolvedValueOnce(verbose());
    vi.stubGlobal('fetch', f);
    const p = transcribeAudio(new Blob(['x']), 'a.mp3', { apiKey: 'k' });
    await vi.advanceTimersByTimeAsync(2900);
    expect(f).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(f).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('aborts the backoff wait as soon as the job is cancelled', async () => {
    const f = vi.fn(async () => new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', f);
    const controller = new AbortController();
    const p = transcribeAudio(new Blob(['x']), 'a.mp3', {
      apiKey: 'k',
      retryDelayMs: 60_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(f).toHaveBeenCalledOnce());
    controller.abort();
    await expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it.each([
    [404, 'model not found'],
    [400, '{"error":{"message":"The model `whisper-x` does not exist"}}'],
  ])('%i → MODEL_UNAVAILABLE', async (status, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status })),
    );
    await expect(
      transcribeAudio(new Blob(['x']), 'a.mp3', { apiKey: 'k', maxAttempts: 1 }),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });
});
