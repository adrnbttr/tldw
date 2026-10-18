import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Summary } from '@/types';
import { DEFAULT_SETTINGS, AVAILABLE_MODELS, AUDIO_MODELS, RETIRED_MODELS } from '@/types';

let store: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: store[key] })),
      set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(store, o)),
    },
  },
});

import {
  clearHistory,
  deleteHistoryEntry,
  findCachedSummary,
  findSummaryByKey,
  getHistory,
  getHistoryEntries,
  getSettings,
  saveSummary,
} from './index';

const summary = (title: string, locale: Summary['locale'] = 'en'): Summary =>
  ({ videoId: 'v', title, locale }) as Summary;

beforeEach(() => {
  store = {};
});

describe('model registry & repair', () => {
  it('defaults are in the registry and not retired', () => {
    expect(AVAILABLE_MODELS.map((m) => m.id)).toContain(DEFAULT_SETTINGS.summaryModel);
    expect(AUDIO_MODELS.map((m) => m.id)).toContain(DEFAULT_SETTINGS.audioModel);
    expect(Object.keys(RETIRED_MODELS)).not.toContain(DEFAULT_SETTINGS.summaryModel);
  });

  it('migrates retired models (summary and audio)', async () => {
    store.settings = {
      summaryModel: 'anthropic/claude-sonnet-4',
      audioModel: 'google/gemini-2.5-flash',
    };
    const s = await getSettings();
    expect(s.summaryModel).toBe('anthropic/claude-sonnet-5.5');
    expect(s.audioModel).toBe('google/gemini-3.1-flash-lite');
  });

  it('keeps a valid user choice, even outside the registry', async () => {
    store.settings = {
      summaryModel: 'meta-llama/custom-model',
      audioModel: 'google/gemini-3.5-flash',
    };
    const s = await getSettings();
    expect(s.summaryModel).toBe('meta-llama/custom-model');
    expect(s.audioModel).toBe('google/gemini-3.5-flash');
  });

  it('never maps a retired audio model to a non-audio model', async () => {
    store.settings = { audioModel: 'anthropic/claude-sonnet-4' };
    expect((await getSettings()).audioModel).toBe(DEFAULT_SETTINGS.audioModel);
  });
});

describe('history / cache keys', () => {
  it('two native videos with empty externalId do not collide', async () => {
    await saveSummary('native', '', summary('A'), { mediaSrc: 'https://x/a.mp4' });
    await saveSummary('native', '', summary('B'), { mediaSrc: 'https://x/b.mp4' });
    expect((await getHistory()).map((s) => s.title).sort()).toEqual(['A', 'B']);
    const a = await findCachedSummary('native', '', {
      mediaSrc: 'https://x/a.mp4',
      outputLanguage: 'en',
    });
    expect(a?.title).toBe('A');
  });

  it('never stores a raw signed URL in a key; fragment is ignored', async () => {
    const url = 'https://cdn.example/v.mp4?sig=SECRET';
    await saveSummary('native', '', summary('A'), { mediaSrc: url });
    const keys = (store.history as { key: string }[]).map((e) => e.key);
    expect(keys[0]).toMatch(/^native:#[0-9a-f]{8}\|en$/);
    expect(keys[0]).not.toContain('SECRET');
    expect(
      await findCachedSummary('native', '', { mediaSrc: url + '#t=5', outputLanguage: 'en' }),
    ).not.toBeNull();
  });

  it('natives without a stable key are neither cached nor deduplicated', async () => {
    await saveSummary('native', '', summary('A'));
    await saveSummary('native', '', summary('B'));
    expect(await getHistory()).toHaveLength(2);
    expect(await findCachedSummary('native', '')).toBeNull();
  });

  it('cache lookup is per output language', async () => {
    await saveSummary('youtube', 'abc', summary('EN', 'en'));
    expect(await findCachedSummary('youtube', 'abc', { outputLanguage: 'fr' })).toBeNull();
    expect((await findCachedSummary('youtube', 'abc', { outputLanguage: 'en' }))?.title).toBe('EN');
    await saveSummary('youtube', 'abc', summary('FR', 'fr'));
    expect(await getHistory()).toHaveLength(2);
  });

  it('legacy entries (key without language) still match their own locale', async () => {
    store.history = [{ key: 'youtube:abc', summary: summary('old', 'fr') }];
    expect((await findCachedSummary('youtube', 'abc', { outputLanguage: 'fr' }))?.title).toBe(
      'old',
    );
    expect(await findCachedSummary('youtube', 'abc', { outputLanguage: 'de' })).toBeNull();
    expect((await findCachedSummary('youtube', 'abc'))?.title).toBe('old');
  });

  it('re-saving replaces the same video+language, including a legacy entry', async () => {
    store.history = [{ key: 'youtube:abc', summary: summary('old', 'en') }];
    await saveSummary('youtube', 'abc', summary('new', 'en'));
    expect((await getHistory()).map((s) => s.title)).toEqual(['new']);
  });
});

describe('cache key includes the summary model', () => {
  const made = (model: string, locale: Summary['locale'] = 'fr'): Summary =>
    ({ videoId: 'v', title: model, locale, model }) as Summary;
  const A = 'google/gemini-3.1-flash-lite';
  const B = 'anthropic/claude-sonnet-5.5';

  it('a summary made with model A is not served once model B is selected', async () => {
    // Regression (v0.4.0 RC review): the cache ignored the model.
    await saveSummary('youtube', 'abc', made(A), { outputLanguage: 'fr', summaryModel: A });
    expect(
      await findCachedSummary('youtube', 'abc', { outputLanguage: 'fr', summaryModel: B }),
    ).toBeNull();
    expect(
      (await findCachedSummary('youtube', 'abc', { outputLanguage: 'fr', summaryModel: A }))?.model,
    ).toBe(A);
  });

  it('keeps one entry per model, and re-saving the same model replaces it', async () => {
    await saveSummary('youtube', 'abc', made(A), { outputLanguage: 'fr', summaryModel: A });
    await saveSummary('youtube', 'abc', made(B), { outputLanguage: 'fr', summaryModel: B });
    await saveSummary('youtube', 'abc', made(A), { outputLanguage: 'fr', summaryModel: A });
    expect((await getHistoryEntries()).map((e) => e.key)).toEqual([
      `youtube:abc|fr|${A}`,
      `youtube:abc|fr|${B}`,
    ]);
  });

  it('legacy language-only and bare keys still match when their model does', async () => {
    store.history = [
      { key: 'youtube:old|fr', summary: made(A) },
      { key: 'youtube:bare', summary: made(A) },
    ];
    const ref = (m: string) => ({ outputLanguage: 'fr', summaryModel: m });
    expect((await findCachedSummary('youtube', 'old', ref(A)))?.model).toBe(A);
    expect(await findCachedSummary('youtube', 'old', ref(B))).toBeNull();
    expect((await findCachedSummary('youtube', 'bare', ref(A)))?.model).toBe(A);
    expect(await findCachedSummary('youtube', 'bare', ref(B))).toBeNull();
    // Re-saving with the same model replaces the legacy entry.
    await saveSummary('youtube', 'old', made(A), ref(A));
    expect((await getHistoryEntries()).map((e) => e.key)).toEqual([
      `youtube:old|fr|${A}`,
      'youtube:bare',
    ]);
  });
});

describe('non-cacheable history entries', () => {
  it('a noCache save is kept in history, findable by key, never a cache hit', async () => {
    const key = await saveSummary(
      'youtube',
      'abc',
      { ...summary('partial', 'fr'), partial: true },
      { outputLanguage: 'fr' },
      { noCache: true },
    );
    expect(key.startsWith('nocache:')).toBe(true);
    expect(await findCachedSummary('youtube', 'abc', { outputLanguage: 'fr' })).toBeNull();
    expect((await findSummaryByKey(key))?.partial).toBe(true);
  });
});

describe('history management', () => {
  it('deletes one entry by key, and clears everything', async () => {
    await saveSummary('youtube', 'a', summary('A'), { outputLanguage: 'en' });
    await saveSummary('youtube', 'b', summary('B'), { outputLanguage: 'en' });
    await deleteHistoryEntry('youtube:a|en');
    expect((await getHistory()).map((s) => s.title)).toEqual(['B']);
    await clearHistory();
    expect(await getHistory()).toEqual([]);
  });
});

describe('history serialization', () => {
  it('two concurrent saves keep both entries', async () => {
    const tick = () => new Promise((r) => setTimeout(r, 1));
    const g = vi.mocked(chrome.storage.local.get);
    const st = vi.mocked(chrome.storage.local.set);
    g.mockImplementationOnce(async (k) => {
      await tick();
      return { [k as string]: store[k as string] };
    });
    store = { settings: { historyLimit: 50, uiLanguage: 'en', outputLanguage: 'en' } };
    const slowGet = async (k: string) => {
      await tick();
      return { [k]: structuredClone(store[k]) };
    };
    const slowSet = async (o: Record<string, unknown>) => {
      await tick();
      Object.assign(store, structuredClone(o));
    };
    g.mockImplementation(slowGet as never);
    st.mockImplementation(slowSet as never);
    await Promise.all([
      saveSummary('youtube', 'AAA', summary('A'), { outputLanguage: 'en' }),
      saveSummary('youtube', 'BBB', summary('B'), { outputLanguage: 'en' }),
    ]);
    expect((await getHistory()).map((x) => x.title).sort()).toEqual(['A', 'B']);
  });
});
