import type { DetectedVideo } from './video';
import type { Summary } from './summary';
import type { TldwErrorCode } from './errors';
import type { LogEntry } from '@/shared/logger';

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

/** Measured amounts behind a progress phase (units depend on the phase). */
export interface ProgressData {
  done?: number;
  total?: number;
  /** End boundary (seconds) of the chunk being processed, to interpolate within it. */
  until?: number;
  unit?: 'bytes' | 'seconds' | 'items';
  /** Jobs waiting before this one (queued phase). */
  ahead?: number;
}

/** Weighted, monotonic progress of a running job (see shared/job-progress.ts). */
export interface JobPercent {
  /** 0-100, never decreases. */
  percent: number;
  phase: 'queued' | 'captions' | 'download' | 'extract' | 'transcription' | 'summary' | 'done';
  done?: number;
  total?: number;
  unit?: ProgressData['unit'];
  ahead?: number;
  /** Estimated seconds left; present only once stable. */
  etaSeconds?: number;
}

export type JobState =
  | { phase: 'idle' }
  | { phase: 'running'; videoId: string; steps: JobProgress[]; progress?: JobPercent }
  | { phase: 'done'; videoId: string; summary: Summary }
  | {
      phase: 'error';
      videoId: string;
      code: TldwErrorCode;
      message: string;
      /** Optional technical detail (e.g. the underlying ffmpeg/API error). */
      detail?: string;
      /** Seconds to wait before retrying (RATE_LIMITED), when the provider said so. */
      retryAfter?: number;
      /** Epoch ms of the failure, set with `retryAfter`: the popup counts down from it. */
      failedAt?: number;
    };

/** popup → background */
export type Request =
  | { type: 'LIST_VIDEOS' }
  | { type: 'RESCAN' }
  | { type: 'GET_JOBS' }
  /** `force`: bypass the summary cache (the user asked to regenerate). */
  | { type: 'SUMMARIZE'; video: DetectedVideo; force?: boolean }
  | { type: 'SUMMARIZE_BATCH'; videos: DetectedVideo[] }
  | { type: 'CANCEL'; videoId: string }
  | { type: 'CLEAR_LOGS' }
  | { type: 'GET_DIAGNOSTICS' };

/** A job with the stable key of its video (shared/video-key.ts), for popup matching. */
export interface KeyedJob {
  key: string;
  state: JobState;
}

/** Response to a `Request` (via sendResponse). */
export type Response =
  | { ok: true; videos: DetectedVideo[] }
  | { ok: true; state: JobState }
  | { ok: true; jobs: KeyedJob[] }
  | { ok: true; report: string }
  | { ok: true }
  | { ok: false; code: TldwErrorCode; message: string };

/** background → popup (broadcast, fire-and-forget). */
export type Broadcast = { type: 'JOB_STATE'; state: JobState };

/** offscreen/content/popup → background: one redacted log line, fire-and-forget —
 * the worker is the single writer of the central log buffer. */
export type LogMessage = { type: 'LOG'; entry: LogEntry };

/**
 * content → background (detection results of the sending frame). `frameKey` is
 * the identity the frame derives from its own URL (`knownEmbedKey(location.href)`,
 * null when it is not a known hosted player): the only identity the worker lets
 * replace a parent's placeholder (background/frame-videos.ts).
 */
export type ContentMessage = {
  type: 'VIDEOS_DETECTED';
  videos: DetectedVideo[];
  frameKey?: string | null;
};

/** background → content: briefly play a video (muted) to trigger media capture. */
export type PrimeMediaMessage = { type: 'PRIME_MEDIA'; video: DetectedVideo };

/** background → content: fetch a URL from the page's own origin (e.g. YouTube
 * captions, which are only served to the youtube.com page context). */
export type FetchTextMessage = { type: 'FETCH_TEXT'; url: string };

/** background → content (all frames of a tab): reset the dedup signature and
 * publish the current list again — after a worker restart or a popup rescan. */
export type ReportVideosMessage = { type: 'REPORT_VIDEOS' };

export type ContentInbound = PrimeMediaMessage | FetchTextMessage | ReportVideosMessage;
