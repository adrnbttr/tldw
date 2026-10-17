import { describe, expect, it, vi } from 'vitest';
import type { LogEntry } from './logger';
import { createLogger, pushBounded, redact, sanitizeEntry } from './logger';

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

  it('drops oversized data but keeps the line', () => {
    // Five near-2048-char strings survive redaction and blow the 8000 budget.
    const data = Array.from({ length: 5 }, () => 'x'.repeat(3000));
    const out = sanitizeEntry({ ...valid, msg: 'big', data });
    expect(out?.msg).toBe('big');
    expect(out?.data).toBe('[dropped: oversized]');
  });

  it('drops unserializable data', () => {
    expect(sanitizeEntry({ ...valid, data: { count: 10n } })?.data).toBe('[dropped: oversized]');
  });
});
