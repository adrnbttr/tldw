import { describe, it, expect } from 'vitest';
import { TldwError, ERROR_MESSAGES, messageFor } from './errors';

describe('messageFor', () => {
  it('maps a TldwError to its message', () => {
    expect(messageFor(new TldwError('MISSING_OPENROUTER_KEY', 'x'))).toBe(
      ERROR_MESSAGES.MISSING_OPENROUTER_KEY,
    );
  });

  it('appends the provider message when present', () => {
    const msg = messageFor(new TldwError('QUOTA_EXCEEDED', 'x', 'retry after 30s'));
    expect(msg).toContain(ERROR_MESSAGES.QUOTA_EXCEEDED);
    expect(msg).toContain('retry after 30s');
  });

  it('falls back to UNKNOWN for non-TldwError values', () => {
    expect(messageFor(new Error('boom'))).toBe(ERROR_MESSAGES.UNKNOWN);
    expect(messageFor('nope')).toBe(ERROR_MESSAGES.UNKNOWN);
  });

  it('has a message for every error code', () => {
    for (const value of Object.values(ERROR_MESSAGES)) {
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
