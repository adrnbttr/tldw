import type { DetectedVideo } from './video';
import type { Summary, DetailLevel } from './summary';
import type { TldwErrorCode } from './errors';

/**
 * The typed message protocol between contexts.
 *
 * - popup  → background : requests (list videos, summarize, cancel, ...)
 * - background → popup  : progress + terminal results, pushed via chrome.runtime
 *
 * Long jobs run in the service worker, so the popup can close and reopen and just
 * re-subscribe to the current job state (F2).
 */

/** Ordered steps of a summarization job, shown in the processing view (F2). */
export type JobStep = 'detect' | 'captions' | 'audio_capture' | 'transcription' | 'summarize';

export type JobStepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface JobProgress {
  videoId: string;
  step: JobStep;
  status: JobStepStatus;
  /** Optional human-readable detail, e.g. "3 min 20 / 12 min". */
  detail?: string;
}

export type JobState =
  | { phase: 'idle' }
  | { phase: 'running'; videoId: string; steps: JobProgress[] }
  | { phase: 'done'; videoId: string; summary: Summary }
  | {
      phase: 'error';
      videoId: string;
      code: TldwErrorCode;
      message: string;
      /** Optional technical detail (e.g. the underlying ffmpeg/API error). */
      detail?: string;
    };

/** popup → background */
export type Request =
  | { type: 'LIST_VIDEOS' }
  | { type: 'GET_JOB_STATE'; videoId: string }
  | { type: 'GET_ACTIVE_JOB' }
  | { type: 'SUMMARIZE'; video: DetectedVideo }
  | { type: 'REGENERATE'; videoId: string; detailLevel: DetailLevel }
  | { type: 'SUMMARIZE_BATCH'; videos: DetectedVideo[] }
  | { type: 'GET_BATCH_STATE' }
  | { type: 'CANCEL'; videoId: string };

/** The running/most-recent job with its video, for popup restore (F2). */
export interface ActiveJob {
  video: DetectedVideo;
  state: JobState;
}

/** Outcome of one video within a batch run (F8). */
export interface BatchItemResult {
  videoId: string;
  title: string;
  ok: boolean;
  /** Error code when `ok` is false, so the UI can localize the message. */
  code?: TldwErrorCode;
  message?: string;
}

export type BatchState =
  | { phase: 'idle' }
  | {
      phase: 'running';
      total: number;
      completed: number;
      currentTitle: string | null;
      results: BatchItemResult[];
    }
  | { phase: 'done'; total: number; results: BatchItemResult[]; summaries: Summary[] };

/** Response to a `Request` (via sendResponse). */
export type Response =
  | { ok: true; videos: DetectedVideo[] }
  | { ok: true; state: JobState }
  | { ok: true; batch: BatchState }
  | { ok: true; active: ActiveJob | null }
  | { ok: true }
  | { ok: false; code: TldwErrorCode; message: string };

/** background → popup (broadcast, fire-and-forget). */
export type Broadcast =
  | { type: 'JOB_PROGRESS'; progress: JobProgress }
  | { type: 'JOB_STATE'; state: JobState }
  | { type: 'BATCH_STATE'; state: BatchState };

/** content → background (detection results for the active tab). */
export type ContentMessage = { type: 'VIDEOS_DETECTED'; videos: DetectedVideo[] };

/** background → content: briefly play a video (muted) to trigger media capture. */
export type PrimeMediaMessage = { type: 'PRIME_MEDIA'; video: DetectedVideo };

/** background → content: fetch a URL from the page's own origin (e.g. YouTube
 * captions, which are only served to the youtube.com page context). */
export type FetchTextMessage = { type: 'FETCH_TEXT'; url: string };

export type ContentInbound = PrimeMediaMessage | FetchTextMessage;
