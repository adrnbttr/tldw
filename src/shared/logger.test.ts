import { describe, expect, it, vi } from 'vitest';
import type { LogEntry } from './logger';
import { createLogger, pushBounded, redact, redactString, sanitizeEntry } from './logger';

describe('redact', () => {
  it('masks sk- style API keys', () => {
    expect(redact('upload failed for sk-or-v1-abc123XYZ, retrying')).toBe(
      'upload failed for [REDACTED], retrying',
    );
  });

  it('masks Bearer tokens', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.token')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });

  it('masks key= query parameters while keeping the rest of the URL', () => {
    expect(redact('https://api.example.com/v1?key=abc123&lang=fr')).toBe(
      'https://api.example.com/v1?key=[REDACTED]&lang=fr',
    );
  });

  it('masks Google, GitHub and GitLab tokens', () => {
    expect(redact('upload with AIzaSyD-1234567890abcdefghijklmnopqrstu failed')).toBe(
      'upload with [REDACTED] failed',
    );
    expect(redact('push failed for ghp_0123456789abcdefghijklmnopqrstuvwx')).toBe(
      'push failed for [REDACTED]',
    );
    expect(redact('gitlab auth github_pat_11BBBaaA0abcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      'gitlab auth [REDACTED]',
    );
    expect(redact('clone rejected glpat-0123456789abcdefghij')).toBe('clone rejected [REDACTED]');
  });

  it('masks secret-bearing query parameters while keeping the rest of the URL', () => {
    expect(redact('https://api.example.com/v1?access_token=tok123&lang=fr&client_secret=shh')).toBe(
      'https://api.example.com/v1?access_token=[REDACTED]&lang=fr&client_secret=[REDACTED]',
    );
    expect(redact('https://x/f?signature=zz&sig=yy&X-Goog-Signature=xx&ok=1')).toBe(
      'https://x/f?signature=[REDACTED]&sig=[REDACTED]&X-Goog-Signature=[REDACTED]&ok=1',
    );
  });

  it('masks signed-media path segments — googlevideo/Drive URLs in path form', () => {
    expect(
      redact(
        'https://rr3---sn-4g5e6nzs.googlevideo.com/videoplayback/expire/1728921600/sig/APq89FMAAAA-9P0lUq3f2R8l5x8lAKOAoyWmBFcO./itag/140/source/youtube/requiressl/yes',
      ),
    ).toBe(
      'https://rr3---sn-4g5e6nzs.googlevideo.com/videoplayback/expire/[REDACTED]/sig/[REDACTED]/itag/140/source/youtube/requiressl/yes',
    );
    expect(
      redact(
        'https://drive.usercontent.google.com/d/expire/1728921600/signature/AMl-mkn0123456789abcdef/file.mp4',
      ),
    ).toBe(
      'https://drive.usercontent.google.com/d/expire/[REDACTED]/signature/[REDACTED]/file.mp4',
    );
  });

  it('masks the values of fields whose name ends with Key, whatever the case', () => {
    expect(redact({ openRouterKey: 'zzz', apiKey: 'zzz', APIKEY: 'zzz', name: 'kept' })).toEqual({
      openRouterKey: '[REDACTED]',
      apiKey: '[REDACTED]',
      APIKEY: '[REDACTED]',
      name: 'kept',
    });
  });

  it('masks fields named after secrets, wherever the keyword sits', () => {
    expect(
      redact({
        accessToken: 't',
        clientSecret: 's',
        Password: 'p',
        passphrase_hint: 'h',
        credentials: 'c',
        note: 'kept',
      }),
    ).toEqual({
      accessToken: '[REDACTED]',
      clientSecret: '[REDACTED]',
      Password: '[REDACTED]',
      passphrase_hint: '[REDACTED]',
      credentials: '[REDACTED]',
      note: 'kept',
    });
  });

  it('masks the Authorization field at any depth', () => {
    expect(redact({ headers: { Authorization: 'Bearer abc.def' }, ok: true })).toEqual({
      headers: { Authorization: '[REDACTED]' },
      ok: true,
    });
  });

  it('flattens Errors to redacted name, message and stack', () => {
    const out = redact(new TypeError('boom sk-or-v1-abc123')) as Record<string, unknown>;
    expect(out.name).toBe('TypeError');
    expect(out.message).toBe('boom [REDACTED]');
    expect(typeof out.stack).toBe('string');
    expect(JSON.stringify(out)).not.toContain('sk-or-v1-abc123');
  });

  it('truncates strings beyond 2048 characters, reporting the cut length', () => {
    const out = redact({ blob: 'a'.repeat(3000) }) as { blob: string };
    expect(out.blob).toBe(`${'a'.repeat(2048)}…[+952 chars]`);
  });

  it('deep-copies without mutating the input and tolerates circular references', () => {
    const input: Record<string, unknown> = { nested: { note: 'safe' } };
    input.self = input;
    const out = redact(input) as Record<string, unknown>;

    expect(input.nested).toEqual({ note: 'safe' });
    expect(out.nested).toEqual({ note: 'safe' });
    expect(out.nested).not.toBe(input.nested);
    expect(out.self).toBe('[Circular]');
  });
});

describe('pushBounded', () => {
  const entry = (i: number): LogEntry => ({ t: i, level: 'info', source: 'sw', msg: `m${i}` });

  it('appends below capacity and returns a new array without touching the input', () => {
    const entries = [entry(1), entry(2)];
    const out = pushBounded(entries, entry(3));
    expect(out).toEqual([entry(1), entry(2), entry(3)]);
    expect(out).not.toBe(entries);
    expect(entries).toEqual([entry(1), entry(2)]);
  });

  it('evicts the oldest entries once the 500-entry capacity is exceeded', () => {
    let entries: LogEntry[] = [];
    for (let i = 0; i < 502; i++) entries = pushBounded(entries, entry(i));
    expect(entries).toHaveLength(500);
    expect(entries[0]).toEqual(entry(2));
    expect(entries.at(-1)).toEqual(entry(501));
  });

  it('honours a custom capacity', () => {
    expect(pushBounded([entry(1), entry(2)], entry(3), 2)).toEqual([entry(2), entry(3)]);
  });
});

describe('createLogger', () => {
  it('routes each method to its level and ships a redacted entry to the sink', () => {
    const sink = vi.fn();
    const logger = createLogger('offscreen', sink);
    const before = Date.now();

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e', { openRouterKey: 'sk-or-v1-abc123' });

    expect(sink).toHaveBeenCalledTimes(4);
    const levels = sink.mock.calls.map((call) => (call[0] as LogEntry).level);
    expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
    expect(sink).toHaveBeenLastCalledWith(
      expect.objectContaining({
        t: expect.any(Number),
        level: 'error',
        source: 'offscreen',
        msg: 'e',
        data: { openRouterKey: '[REDACTED]' },
      }),
    );
    expect((sink.mock.calls[3][0] as LogEntry).t).toBeGreaterThanOrEqual(before);
  });

  it('redacts the msg itself, not just the data', () => {
    const sink = vi.fn();
    createLogger('content', sink).info('fetch failed for key=sk-or-v1-abc123');
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'fetch failed for key=[REDACTED]' }),
    );
  });

  it('never lets a throwing sink break the caller', () => {
    const logger = createLogger('popup', () => {
      throw new Error('sink down');
    });
    expect(() => {
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
    }).not.toThrow();
  });
});

describe('sanitizeEntry', () => {
  const valid = {
    t: Date.now(),
    level: 'warn',
    source: 'content',
    msg: 'hello',
    data: { apiKey: 'zzz' },
  };

  it('accepts a well-formed entry and re-redacts msg and data', () => {
    expect(sanitizeEntry(valid)).toEqual({
      t: valid.t,
      level: 'warn',
      source: 'content',
      msg: 'hello',
      data: { apiKey: '[REDACTED]' },
    });
  });

  it('accepts a timestamp skewed within the hour, either way', () => {
    const skew = 59 * 60 * 1000; // safely inside ±1 h
    const past = Date.now() - skew;
    const future = Date.now() + skew;
    expect(sanitizeEntry({ ...valid, t: past })?.t).toBe(past);
    expect(sanitizeEntry({ ...valid, t: future })?.t).toBe(future);
  });

  it('redacts and truncates an oversized msg', () => {
    expect(sanitizeEntry({ ...valid, msg: 'failed key=abc123' })?.msg).toBe(
      'failed key=[REDACTED]',
    );
    expect(sanitizeEntry({ ...valid, msg: 'a'.repeat(3000) })?.msg).toBe(
      `${'a'.repeat(2048)}…[+952 chars]`,
    );
  });

  it.each([
    ['null', null],
    ['a bare string', 'not an entry'],
    ['a missing t', { level: 'info', source: 'sw', msg: 'm' }],
    ['a non-number t', { t: '123', level: 'info', source: 'sw', msg: 'm' }],
    ['a NaN t', { t: Number.NaN, level: 'info', source: 'sw', msg: 'm' }],
    ['an infinite t', { t: Number.POSITIVE_INFINITY, level: 'info', source: 'sw', msg: 'm' }],
    [
      'a t an hour too old',
      { t: Date.now() - 61 * 60 * 1000, level: 'info', source: 'sw', msg: 'm' },
    ],
    [
      'a t an hour too fresh',
      { t: Date.now() + 61 * 60 * 1000, level: 'info', source: 'sw', msg: 'm' },
    ],
    ['an unknown level', { t: 1, level: 'loud', source: 'sw', msg: 'm' }],
    ['an unknown source', { t: 1, level: 'info', source: 'nirvana', msg: 'm' }],
    ['a non-string msg', { t: 1, level: 'info', source: 'sw', msg: 42 }],
  ])('rejects %s', (_kind, raw) => {
    expect(sanitizeEntry(raw)).toBeNull();
  });

  it('shrinks oversized data progressively, keeping scalars and the code', () => {
    const data = {
      code: 'MEDIA_NOT_CAPTURABLE',
      status: 403,
      sources: Array.from({ length: 5 }, () => 'x'.repeat(3000)),
    };
    const out = sanitizeEntry({ ...valid, msg: 'big', data });
    expect(out?.msg).toBe('big');
    const shrunk = out?.data as typeof data;
    expect(shrunk.code).toBe('MEDIA_NOT_CAPTURABLE');
    expect(shrunk.status).toBe(403);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(8000);
  });

  it('truncates long arrays with a "+k more" marker', () => {
    const data = { items: Array.from({ length: 2000 }, (_, i) => `item-${i}`) };
    const out = sanitizeEntry({ ...valid, data });
    const items = (out?.data as { items: unknown[] }).items;
    expect(items.at(-1)).toMatch(/^…\+\d+ more$/);
    expect(items.length).toBeLessThan(30);
  });

  it('drops data only when nothing smaller fits', () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) data[`k${i}`] = 'v';
    expect(sanitizeEntry({ ...valid, data })?.data).toBe('[dropped: oversized]');
  });

  it('stringifies bigints instead of failing', () => {
    expect(sanitizeEntry({ ...valid, data: { count: 10n } })?.data).toEqual({ count: '10n' });
  });

  it('drops data that throws while being read', () => {
    const data = {
      get boom(): string {
        throw new Error('nope');
      },
    };
    expect(sanitizeEntry({ ...valid, data })?.data).toBe('[dropped: oversized]');
  });
});

describe('redaction hardening', () => {
  it.each([
    ['https://x.test/a?api_key=SECRETVAL&b=1', 'SECRETVAL'],
    ['https://x.test/a?apiKey=SECRETVAL', 'SECRETVAL'],
    ['x.test/a?foo=1&refresh_token=SECRETVAL', 'SECRETVAL'],
    ['x.test/a?id_token=SECRETVAL', 'SECRETVAL'],
    ['x.test/a?access_token=SECRETVAL', 'SECRETVAL'],
    ['x.test/a?lsig=SECRETVAL&b', 'SECRETVAL'],
    ['x.test/a?sig=SECRETVAL', 'SECRETVAL'],
    ['x.test/a?auth=SECRETVAL', 'SECRETVAL'],
    ['x.test/a#token=SECRETVAL', 'SECRETVAL'],
    ['x.test/a;key=SECRETVAL', 'SECRETVAL'],
    ['x.test/a?client_secret=SECRETVAL', 'SECRETVAL'],
    ['x.test/a?my_secret_thing=SECRETVAL', 'SECRETVAL'],
    ['token=SECRETVAL', 'SECRETVAL'],
    ['{"apiKey":"SECRETVAL","n":1}', 'SECRETVAL'],
    ['{"Set-Cookie": "sid=SECRETVAL"}', 'SECRETVAL'],
    ['{"password":"SECRETVAL"}', 'SECRETVAL'],
    ['Authorization: Basic dXNlcjpTRUNSRVRWQUw=', 'dXNlcjpTRUNSRVRWQUw'],
    ['Authorization: Bearer SECRETVAL', 'SECRETVAL'],
    ['Cookie: sid=SECRETVAL; a=b', 'SECRETVAL'],
    ['key gsk_abcdefghijklmnopqrstuvwxyz0123 end', 'gsk_abcdefghij'],
    ['key AIzaSyA-abcdefghijklmnopqrstuv end', 'AIzaSyA'],
    ['key sk-ant-api03-abcdef end', 'sk-ant'],
    ['key sk-or-v1-abcdef0123 end', 'sk-or-v1'],
  ])('masks %s', (input, secret) => {
    const out = redactString(input);
    expect(out).not.toContain(secret);
    expect(out).toContain('[REDACTED]');
  });

  it('masks path-embedded tokens and IPs', () => {
    const out = redactString(
      'v.test/videoplayback/expire/1/ei/Y/ip/203.0.113.42/sig/ZZZ/lsig/TOKEN123/x.mp4 ' +
        'vod.vimeocdn.com/exp=1712345678~acl=%2Fabc%2F~hmac=0123abcd/seg.m4s ' +
        'drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view from 198.51.100.7',
    );
    for (const leak of [
      '203.0.113.42',
      'ZZZ',
      'TOKEN123',
      '0123abcd',
      '1712345678',
      '%2Fabc%2F',
      '1AbCdEfGhIjKlMnOp',
      '198.51.100.7',
    ]) {
      expect(out).not.toContain(leak);
    }
  });

  it('leaves version strings and plain text alone', () => {
    expect(redactString('Chrome/120.0.0.0 Basic information keyframe=3')).toBe(
      'Chrome/120.0.0.0 Basic information keyframe=3',
    );
  });

  it('masks cookie fields', () => {
    expect(redact({ cookie: 'a', 'set-cookie': 'b', Cookie: 'c', sig: 'd' })).toEqual({
      cookie: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      Cookie: '[REDACTED]',
      sig: '[REDACTED]',
    });
  });

  it('keeps own props and cause of an Error, redacted', () => {
    const err = Object.assign(new Error('boom', { cause: new Error('inner sk-abcdef123') }), {
      code: 'API_ERROR',
      status: 429,
      providerMessage: 'bad key sk-secret123',
      apiKey: 'zzz',
    });
    const out = redact(err) as Record<string, unknown> & { cause: { message: string } };
    expect(out.code).toBe('API_ERROR');
    expect(out.status).toBe(429);
    expect(out.providerMessage).not.toContain('sk-secret123');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.cause.message).not.toContain('sk-abcdef123');
  });

  it('converts Map and Set to plain data, checking Map keys', () => {
    const out = redact({
      m: new Map<string, unknown>([
        ['a', 1],
        ['apiKey', 'zzz'],
      ]),
      s: new Set([1, 'sk-abcdef123']),
    }) as { m: unknown; s: unknown[] };
    expect(out.m).toEqual({ a: 1, apiKey: '[REDACTED]' });
    expect(out.s).toEqual([1, '[REDACTED]']);
  });

  it('only flags true cycles as circular, not shared references', () => {
    const shared = { v: 1 };
    const out = redact({ a: shared, b: shared, list: [shared, shared] }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain('Circular');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(redact(loop)).toEqual({ self: '[Circular]' });
  });
});
