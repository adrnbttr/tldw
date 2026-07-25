import type { Settings, Summary } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';

/**
 * chrome.storage.local access layer (F9).
 *
 * Nothing here is ever transmitted anywhere. API keys live in local storage and
 * are read only when a request is made directly to the provider concerned.
 */

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'history';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** History cache key: provider + externalId (spec §3.9). */
export function historyKey(provider: string, externalId: string): string {
  return `${provider}:${externalId}`;
}

interface HistoryEntry {
  key: string;
  summary: Summary;
}

export async function getHistory(): Promise<Summary[]> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const entries = (stored[HISTORY_KEY] as HistoryEntry[] | undefined) ?? [];
  return entries.map((e) => e.summary);
}

export async function findCachedSummary(
  provider: string,
  externalId: string,
): Promise<Summary | null> {
  if (!externalId) return null;
  const key = historyKey(provider, externalId);
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const entries = (stored[HISTORY_KEY] as HistoryEntry[] | undefined) ?? [];
  return entries.find((e) => e.key === key)?.summary ?? null;
}

export async function saveSummary(
  provider: string,
  externalId: string,
  summary: Summary,
): Promise<void> {
  const { historyLimit } = await getSettings();
  const key = historyKey(provider, externalId);
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const entries = (stored[HISTORY_KEY] as HistoryEntry[] | undefined) ?? [];

  const deduped = entries.filter((e) => e.key !== key);
  deduped.unshift({ key, summary });

  await chrome.storage.local.set({ [HISTORY_KEY]: deduped.slice(0, historyLimit) });
}
