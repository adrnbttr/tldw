import { describe, it, expect, vi } from 'vitest';

const listeners = new Set<unknown>();
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    on(_: string, cb: unknown) {
      listeners.add(cb);
    }
    off(_: string, cb: unknown) {
      listeners.delete(cb);
    }
    async load() {}
    terminate() {}
  },
}));
vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => `chrome-extension://x/${p}` } });

import { FfmpegAudio } from './audio';

describe('FfmpegAudio log listener', () => {
  it('keeps a single listener across reloads and removes it on terminate', async () => {
    const audio = new FfmpegAudio();
    await audio.load();
    audio.terminate();
    await audio.load();
    await audio.load();
    expect(listeners.size).toBe(1);
    audio.terminate();
    expect(listeners.size).toBe(0);
  });
});
