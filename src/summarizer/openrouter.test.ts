import { describe, it, expect, vi, afterEach } from 'vitest';
import type { TldwError } from '@/types';

vi.mock('@/background/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { chat, classifyHttpError, parseRetryAfter } from './openrouter';

const respond = (status: number, body = '', headers: Record<string, string> = {}) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, headers })),
  );

const run = (): Promise<TldwError> =>
  chat({ apiKey: 'k', model: 'm', messages: [] }).then(
    () => {
      throw new Error('expected failure');
    },
    (e: TldwError) => e,
  );

afterEach(() => vi.unstubAllGlobals());

describe('classifyHttpError', () => {
  it.each([
    [401, '', 'INVALID_API_KEY'],
    [403, '', 'INVALID_API_KEY'],
    [402, '', 'INSUFFICIENT_CREDITS'],
    [429, '', 'RATE_LIMITED'],
    [404, '', 'MODEL_UNAVAILABLE'],
    [400, '{"error":"google/x is not a valid model ID"}', 'MODEL_UNAVAILABLE'],
    [400, '{"error":"maximum context length is 1000 tokens"}', 'CONTEXT_TOO_LONG'],
    [400, 'bad request', 'SUMMARY_API_ERROR'],
    [500, '', 'SUMMARY_API_ERROR'],
  ])('%s %s → %s', (status, body, code) => {
    expect(classifyHttpError(status, body)).toBe(code);
  });
});

describe('chat error mapping', () => {
  it('429 carries structured retryAfter and the provider detail', async () => {
    respond(429, 'slow down', { 'retry-after': '12' });
    const err = await run();
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryAfter).toBe(12);
    expect(err.providerMessage).toBe('slow down');
    expect(err.providerMessage).not.toMatch(/réessayez/);
  });

  it('401 → INVALID_API_KEY, 402 → INSUFFICIENT_CREDITS', async () => {
    respond(401, 'no');
    expect((await run()).code).toBe('INVALID_API_KEY');
    respond(402, 'pay');
    expect((await run()).code).toBe('INSUFFICIENT_CREDITS');
  });
});

describe('request body', () => {
  it('sends strict json_schema when provided, json_object otherwise', async () => {
    const f = vi.fn(
      async (..._args: unknown[]) =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', f);
    await chat({
      apiKey: 'k',
      model: 'm',
      messages: [],
      jsonMode: true,
      jsonSchema: { name: 'n', schema: { type: 'object' } },
    });
    await chat({ apiKey: 'k', model: 'm', messages: [], jsonMode: true });
    const bodies = f.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies[0].response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'n', strict: true, schema: { type: 'object' } },
    });
    expect(bodies[1].response_format).toEqual({ type: 'json_object' });
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and ignores junk', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});
