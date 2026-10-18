import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The offscreen document only takes jobs from the service worker: a job
 * carries the API keys and the media URLs to fetch. Regression (v0.4.0 RC
 * review): OFFSCREEN_TRANSCRIBE was accepted from any sender.
 */
const downloadSource = vi.fn(async () => new Uint8Array(0));
vi.mock('./download', () => ({ downloadSource, safePath: (u: string) => u }));
vi.mock('./worker-link', () => ({ openWorkerLink: () => ({ close: vi.fn() }) }));
vi.mock('@/transcription/audio', () => ({
  AUDIO_BYTES_PER_SECOND: 8000,
  planAudioWindows: vi.fn(() => []),
  FfmpegAudio: class {
    terminate() {}
    writeSource = vi.fn(async () => 'in');
    probeDuration = vi.fn(async () => 0);
    removeSource = vi.fn(async () => {});
  },
}));
vi.mock('@/shared/logger-client', () => ({
  createClientLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));

type Listener = (msg: unknown, sender: unknown) => unknown;
let listeners: Listener[];
const SW_URL = 'chrome-extension://EXT/service-worker-loader.js';

const manifestFetch = vi.fn(async (url: string) => {
  if (url !== 'chrome-extension://EXT/manifest.json') throw new Error(`unexpected fetch ${url}`);
  return { json: async () => ({ background: { service_worker: 'service-worker-loader.js' } }) };
});

beforeEach(() => {
  vi.resetModules();
  downloadSource.mockClear();
  manifestFetch.mockClear();
  listeners = [];
  vi.stubGlobal('fetch', manifestFetch);
  // An offscreen document only gets a subset of chrome.runtime: no getManifest
  // (regression: the sender check called it and threw on every job — found by
  // e2e/pipeline.mjs, the first real-browser run of the audio path).
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'EXT',
      getURL: (p: string) => `chrome-extension://EXT/${p}`,
      onMessage: { addListener: (l: Listener) => listeners.push(l) },
      sendMessage: vi.fn(async () => undefined),
    },
  });
});

const job = { jobId: 'j1', uiLanguage: 'en', sources: [], duration: 10 };
const dispatch = (sender: unknown) => {
  for (const l of listeners) l({ type: 'OFFSCREEN_TRANSCRIBE', job }, sender);
};

describe('offscreen request sender', () => {
  it('runs a job sent by the service worker', async () => {
    await import('./index');
    dispatch({ id: 'EXT', url: SW_URL });
    await vi.waitFor(() => expect(downloadSource).toHaveBeenCalledOnce());
  });

  it('reads the worker URL from the manifest file once', async () => {
    await import('./index');
    dispatch({ id: 'EXT', url: SW_URL });
    dispatch({ id: 'EXT', url: 'chrome-extension://EXT/src/popup/index.html' });
    await vi.waitFor(() => expect(downloadSource).toHaveBeenCalledOnce());
    expect(manifestFetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['a content script', { id: 'EXT', url: 'https://evil.example/', tab: { id: 4 }, frameId: 2 }],
    ['the popup', { id: 'EXT', url: 'chrome-extension://EXT/src/popup/index.html' }],
    ['another extension', { id: 'OTHER', url: 'chrome-extension://OTHER/x.js' }],
  ])('refuses a job sent by %s', async (_name, sender) => {
    await import('./index');
    dispatch(sender);
    await new Promise((r) => setTimeout(r, 20));
    expect(downloadSource).not.toHaveBeenCalled();
  });
});
