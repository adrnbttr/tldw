import { describe, expect, it } from 'vitest';
import { cleanKey, looksLikeOpenRouterKey } from './key-format';

describe('cleanKey', () => {
  it('drops whitespace, line breaks and surrounding quotes from a pasted key', () => {
    expect(cleanKey('  sk-or-v1-abc\n')).toBe('sk-or-v1-abc');
    expect(cleanKey('"sk-or-v1-abc"')).toBe('sk-or-v1-abc');
    expect(cleanKey('sk-or-v1-a bc')).toBe('sk-or-v1-abc');
    expect(cleanKey('')).toBe('');
  });
});

describe('looksLikeOpenRouterKey', () => {
  it('accepts empty, a prefix being typed, and full keys', () => {
    expect(looksLikeOpenRouterKey('')).toBe(true);
    expect(looksLikeOpenRouterKey('sk-o')).toBe(true);
    expect(looksLikeOpenRouterKey('sk-or-v1-0123')).toBe(true);
  });
  it('flags other values (e.g. an OpenAI key)', () => {
    expect(looksLikeOpenRouterKey('sk-proj-abc')).toBe(false);
    expect(looksLikeOpenRouterKey('hello')).toBe(false);
  });
});
