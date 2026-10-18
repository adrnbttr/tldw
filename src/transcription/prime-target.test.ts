import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DetectedVideo } from '@/types';

const video = (over: Partial<DetectedVideo>): DetectedVideo => ({
  id: 'x',
  provider: 'native',
  externalId: '',
  title: null,
  duration: null,
  iframeSrc: null,
  mediaSrc: null,
  isPlaying: false,
  ...over,
});

describe('PRIME_MEDIA frame targeting', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function sentOptions(v: DetectedVideo): Promise<unknown> {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
    vi.useFakeTimers();
    const { primeAndWait } = await import('./index');
    const p = primeAndWait(v, 5);
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    vi.useRealTimers();
    expect(sendMessage.mock.calls[0][0]).toBe(5);
    return sendMessage.mock.calls[0][2];
  }

  it('targets the reporting frame for a native video', async () => {
    expect(await sentOptions(video({ frameId: 9 }))).toEqual({ frameId: 9 });
  });

  it('broadcasts for embeds and Drive', async () => {
    expect(await sentOptions(video({ provider: 'drive', frameId: 0 }))).toEqual({});
  });
});
