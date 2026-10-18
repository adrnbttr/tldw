import { describe, expect, it } from 'vitest';
import { log, logStore } from './log';

describe('sw logger', () => {
  it('runs local entries through the wire size cap and redaction', async () => {
    log.info('local', {
      n: 10n,
      huge: Array.from({ length: 5 }, () => 'x'.repeat(3000)),
      apiKey: 'sk-abcdef123',
    });
    const entries = await logStore.readAll();
    const last = entries.at(-1);
    expect(last?.msg).toBe('local');
    expect(JSON.stringify(last).length).toBeLessThanOrEqual(8000);
    expect(JSON.stringify(last)).not.toContain('sk-abcdef123');
    expect((last?.data as { n: string }).n).toBe('10n');
  });
});
