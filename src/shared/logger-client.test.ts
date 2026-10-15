import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientLogger } from './logger-client';
import type { LogMessage } from '@/types';

/** Reads the LogMessage payload from the first sendMessage call. */
const firstMessage = (sendMessage: ReturnType<typeof vi.fn>): LogMessage =>
  sendMessage.mock.calls[0][0] as LogMessage;

/** Minimal chrome.runtime mock — the only surface the client logger touches. */
const stubChrome = (sendMessage: (message: unknown) => unknown): void => {
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
};

describe('createClientLogger', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ships each redacted entry to the worker as a LOG message', () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    stubChrome(sendMessage);

    createClientLogger('popup').info('hello', { apiKey: 'sk-or-v1-abc123' });

    expect(sendMessage).toHaveBeenCalledOnce();
    const { type, entry } = firstMessage(sendMessage);
    expect(type).toBe('LOG');
    expect(entry.source).toBe('popup');
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('hello');
    expect(typeof entry.t).toBe('number');
    expect(entry.data).toEqual({ apiKey: '[REDACTED]' });
  });

  it('swallows an asynchronous sendMessage rejection', async () => {
    const sendMessage = vi.fn(() => Promise.reject(new Error('context invalidated')));
    stubChrome(sendMessage);

    expect(() => createClientLogger('content').warn('too late')).not.toThrow();
    await Promise.resolve(); // let the rejection reach our .catch
  });

  it('swallows a synchronous throw from an invalidated context', () => {
    const sendMessage = vi.fn(() => {
      throw new Error('Extension context invalidated');
    });
    stubChrome(sendMessage);

    expect(() => createClientLogger('offscreen').error('gone')).not.toThrow();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('never throws when the chrome global is gone entirely', () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    stubChrome(sendMessage);
    vi.unstubAllGlobals(); // simulate a torn-down context

    expect(() => createClientLogger('popup').debug('orphaned')).not.toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
