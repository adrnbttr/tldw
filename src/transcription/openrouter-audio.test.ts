import { describe, it, expect } from 'vitest';
import { bytesToBase64 } from './openrouter-audio';

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
