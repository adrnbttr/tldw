import type { DetectedVideo, JobState } from '@/types';
import { videoKey } from '@/shared/video-key';

/**
 * "Summarize all" progress bar (F8).
 *
 * Worker job states carry no batch marker, so the popup remembers the stable
 * keys of the videos it sent in SUMMARIZE_BATCH. They live in
 * `chrome.storage.session` (the popup's own `sessionStorage` dies with each
 * popup window), so the bar is still there after the popup is reopened — and
 * two videos summarized one by one never show as a batch.
 */

const STORAGE_KEY = 'popup.batchKeys';

export interface BatchProgress {
  /** Batch videos finished, successfully or not. */
  settled: number;
  total: number;
}

/**
 * Progress of the remembered batch over the listed videos, or null when there
 * is nothing to show: fewer than two batch videos listed, or none of them
 * still running (a video with no known job yet counts as pending).
 */
export function batchProgress(
  videos: DetectedVideo[],
  jobs: Record<string, JobState>,
  batchKeys: readonly string[],
): BatchProgress | null {
  if (batchKeys.length === 0) return null;
  const keys = new Set(batchKeys);
  const members = videos.filter((v) => keys.has(videoKey(v)));
  if (members.length < 2) return null;
  const settled = members.filter((v) => {
    const phase = jobs[v.id]?.phase;
    return phase === 'done' || phase === 'error';
  }).length;
  return settled < members.length ? { settled, total: members.length } : null;
}

/** True once every listed batch video reached a terminal state: the batch can be forgotten. */
export function batchFinished(
  videos: DetectedVideo[],
  jobs: Record<string, JobState>,
  batchKeys: readonly string[],
): boolean {
  if (batchKeys.length === 0 || videos.length === 0) return false;
  const keys = new Set(batchKeys);
  const members = videos.filter((v) => keys.has(videoKey(v)));
  // Another page: its batch is not ours to judge.
  if (members.length === 0) return false;
  return members.every((v) => {
    const phase = jobs[v.id]?.phase;
    return phase === 'done' || phase === 'error';
  });
}

function sessionArea(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.session ? chrome.storage.session : null;
}

export async function loadBatchKeys(): Promise<string[]> {
  const area = sessionArea();
  if (!area) return [];
  const stored = (await area.get(STORAGE_KEY)) as Record<string, unknown>;
  const value = stored[STORAGE_KEY];
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : [];
}

export async function saveBatchKeys(keys: readonly string[]): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  if (keys.length === 0) await area.remove(STORAGE_KEY);
  else await area.set({ [STORAGE_KEY]: [...keys] });
}
