import type { DetectedVideo, Settings, Summary } from '@/types';
import { DEFAULT_SETTINGS, RETIRED_MODELS, AUDIO_MODELS } from '@/types';
import { detectDefaultLocale } from '@/i18n';
import { stableVideoKey } from '@/shared/video-key';

/**
 * chrome.storage.local access layer (F9).
 *
 * Nothing here is ever transmitted anywhere. API keys live in local storage and
 * are read only when a request is made directly to the provider concerned.
 */

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'history';

/** Follows the RETIRED_MODELS chain; returns the id unchanged when not retired. */
export function migrateModel(id: string): string {
  let current = id;
  for (let i = 0; i < 5 && current in RETIRED_MODELS; i++) current = RETIRED_MODELS[current];
  return current;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  // First run: default both languages to the browser's UI language.
  if (!raw?.uiLanguage) merged.uiLanguage = detectDefaultLocale();
  if (!raw?.outputLanguage) merged.outputLanguage = detectDefaultLocale();
  // Migrate retired models to their replacement. Unknown ids are kept: a valid
  // user choice (custom model) must never be silently overwritten.
  merged.summaryModel = migrateModel(merged.summaryModel);
  const migratedAudio = migrateModel(merged.audioModel);
  // A retired audio model must be replaced by one that takes audio input.
  merged.audioModel =
    migratedAudio !== merged.audioModel && !AUDIO_MODELS.some((m) => m.id === migratedAudio)
      ? DEFAULT_SETTINGS.audioModel
      : migratedAudio;
  return merged;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** What identifies a video for dedup/cache purposes. */
export interface VideoRef {
  /** Output language the summary was (or will be) generated in. */
  outputLanguage?: string;
  /**
   * Summary model selected in the settings when the summary was (or will be)
   * generated: a summary made with another model is not a cache hit.
   */
  summaryModel?: string;
  /** Direct media URL of a native `<video>`. */
  mediaSrc?: string | null;
  /** Embed/player URL, when known. */
  iframeSrc?: string | null;
}

/**
 * Stable identity of a video, without language. Hosted videos use their external
 * id; natives (empty id) use their media URL, else null — no stable key, so the
 * summary is neither deduplicated nor served from cache.
 */
export function videoBaseKey(
  provider: string,
  externalId: string,
  ref: VideoRef = {},
): string | null {
  return stableVideoKey({
    provider: provider as DetectedVideo['provider'],
    externalId,
    mediaSrc: ref.mediaSrc ?? null,
    iframeSrc: ref.iframeSrc ?? null,
  });
}

/**
 * Full cache key: identity + output language + summary model
 * (`base|language|model`). Null when there is no stable key. Keys written
 * before the model was part of it (`base|language`, or a bare `base`) are
 * still honored by {@link findCachedSummary} when their summary's model matches.
 */
export function cacheKey(
  provider: string,
  externalId: string,
  language: string | undefined,
  ref: VideoRef = {},
): string | null {
  const base = videoBaseKey(provider, externalId, ref);
  if (!base) return null;
  if (!language) return base;
  return ref.summaryModel ? `${base}|${language}|${ref.summaryModel}` : `${base}|${language}`;
}

/** Prefix of the history entries that are never served from cache (see {@link saveSummary}). */
export const NOCACHE_PREFIX = 'nocache:';

export interface HistoryEntry {
  key: string;
  summary: Summary;
}

async function readEntries(): Promise<HistoryEntry[]> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return (stored[HISTORY_KEY] as HistoryEntry[] | undefined) ?? [];
}

export async function getHistory(): Promise<Summary[]> {
  return (await readEntries()).map((e) => e.summary);
}

/** History with each entry's storage key (for per-entry deletion). */
export async function getHistoryEntries(): Promise<HistoryEntry[]> {
  return readEntries();
}

/** The history entry stored under `key` (exact), if still there. */
export async function findSummaryByKey(key: string): Promise<Summary | null> {
  return (await readEntries()).find((e) => e.key === key)?.summary ?? null;
}

/**
 * Cache lookup. Matches the language- and model-qualified key; entries written
 * before the model (`base|lang`) or the language (bare base key) were part of
 * the key are still honored when their stored model — and, for a bare key,
 * locale — equal the requested ones. Without a requested language, any entry
 * for the video matches; without a requested model, any model of that language.
 * `nocache:` entries never match.
 */
export async function findCachedSummary(
  provider: string,
  externalId: string,
  ref: VideoRef = {},
): Promise<Summary | null> {
  const base = videoBaseKey(provider, externalId, ref);
  if (!base) return null;
  const lang = ref.outputLanguage;
  const model = ref.summaryModel;
  const entries = await readEntries();
  if (!lang) {
    return entries.find((e) => e.key === base || e.key.startsWith(`${base}|`))?.summary ?? null;
  }
  const sameModel = (e: HistoryEntry) => !model || e.summary.model === model;
  if (model) {
    const exact = entries.find((e) => e.key === `${base}|${lang}|${model}`);
    if (exact) return exact.summary;
  } else {
    const anyModel = entries.find((e) => e.key.startsWith(`${base}|${lang}|`));
    if (anyModel) return anyModel.summary;
  }
  const legacyLang = entries.find((e) => e.key === `${base}|${lang}` && sameModel(e));
  if (legacyLang) return legacyLang.summary;
  const legacyBare = entries.find(
    (e) => e.key === base && e.summary.locale === lang && sameModel(e),
  );
  return legacyBare?.summary ?? null;
}

/** Serializes every read-modify-write of the history so concurrent jobs lose nothing. */
let historyQueue: Promise<unknown> = Promise.resolve();
function withHistoryLock<T>(task: () => Promise<T>): Promise<T> {
  const run = historyQueue.then(task, task);
  historyQueue = run.catch(() => undefined);
  return run;
}

export interface SaveOptions {
  /**
   * Keep the summary in history but never serve it from cache (a partial or
   * unattributable audio transcript): stored under a unique `nocache:` key.
   */
  noCache?: boolean;
}

/** Saves a summary in history; resolves with the key it was stored under. */
export async function saveSummary(
  provider: string,
  externalId: string,
  summary: Summary,
  ref: VideoRef = {},
  options: SaveOptions = {},
): Promise<string> {
  const { historyLimit } = await getSettings();
  return withHistoryLock(() =>
    saveSummaryLocked(provider, externalId, summary, ref, historyLimit, options),
  );
}

async function saveSummaryLocked(
  provider: string,
  externalId: string,
  summary: Summary,
  ref: VideoRef,
  historyLimit: number,
  options: SaveOptions,
): Promise<string> {
  const base = options.noCache ? null : videoBaseKey(provider, externalId, ref);
  const language = ref.outputLanguage ?? summary.locale;
  const model = ref.summaryModel;
  // No stable identity (or not cacheable): keep it in history under a unique key, never dedup.
  const key = base
    ? (cacheKey(provider, externalId, language, ref) as string)
    : `${NOCACHE_PREFIX}${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
  const entries = await readEntries();

  // Drop the same video+language+model, including legacy entries of that
  // language (bare or language-only key) made with the same model.
  const legacy = (e: HistoryEntry) =>
    !!base &&
    (!model || e.summary.model === model) &&
    (e.key === `${base}|${language}` || (e.key === base && e.summary.locale === language));
  const deduped = entries.filter((e) => e.key !== key && !legacy(e));
  deduped.unshift({ key, summary });

  await chrome.storage.local.set({ [HISTORY_KEY]: deduped.slice(0, historyLimit) });
  return key;
}

/** Removes one history entry (by its storage key). */
export async function deleteHistoryEntry(key: string): Promise<void> {
  return withHistoryLock(async () => {
    const entries = await readEntries();
    const kept = entries.filter((e) => e.key !== key);
    if (kept.length !== entries.length) await chrome.storage.local.set({ [HISTORY_KEY]: kept });
  });
}

/** Empties the history (and with it the summary cache). */
export async function clearHistory(): Promise<void> {
  return withHistoryLock(() => chrome.storage.local.set({ [HISTORY_KEY]: [] }));
}
