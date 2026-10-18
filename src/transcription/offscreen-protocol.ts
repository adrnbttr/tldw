import type { ProgressData, TranscriptSegment, TldwErrorCode } from '@/types';
import type { MediaCandidate } from './media';

/**
 * Messaging contract between the service worker and the offscreen document.
 *
 * The heavy audio work (ffmpeg.wasm + Whisper) runs in the offscreen document
 * because the MV3 service worker has no DOM. The worker sends a job and receives
 * progress plus a terminal result.
 */

export interface TranscribeJob {
  /**
   * Unique per run (not the video id): the same video can be requested twice,
   * and every offscreen message is matched on this id, so a stale run's
   * messages can never be taken for the current one's.
   */
  jobId: string;
  videoId: string;
  provider: string;
  title: string | null;
  /** Known duration in seconds, if any (helps chunk planning). */
  duration: number | null;
  // No language field on purpose: the summary language is a setting, the
  // spoken language is not — transcription auto-detects it (forcing the
  // output language would make Whisper/Gemini translate instead).
  /** UI language, so offscreen progress messages are localized. */
  uiLanguage: string;
  /** Which backend transcribes: OpenRouter (Gemini) or OpenAI (Whisper). */
  transcriptionProvider: 'openrouter' | 'openai';
  /** OpenRouter key (openrouter provider) + multimodal audio model. */
  openRouterKey: string;
  audioModel: string;
  /** OpenAI key + Whisper model (openai provider). */
  transcriptionKey: string;
  whisperModel: string;
  /** Candidate media sources to try, best-first. */
  sources: MediaCandidate[];
}

export type OffscreenRequest = { type: 'OFFSCREEN_TRANSCRIBE'; job: TranscribeJob };

/**
 * Coarse pipeline phase attached to each progress message, so the worker can
 * time the phases separately: download/extract get a fixed budget,
 * transcription one proportional to the media duration.
 */
export type OffscreenProgressPhase = 'download' | 'extract' | 'transcribe';

export type OffscreenResponse =
  | {
      type: 'OFFSCREEN_PROGRESS';
      jobId: string;
      phase: OffscreenProgressPhase;
      detail: string;
      /** Resolved media duration in seconds, once extraction has probed it. */
      duration?: number;
      /** Measured amounts (bytes downloaded, seconds transcribed…) for the progress bar. */
      data?: ProgressData;
    }
  | {
      type: 'OFFSCREEN_RESULT';
      jobId: string;
      ok: true;
      /** Spoken language detected by the provider; absent when it reports none. */
      language?: string;
      segments: TranscriptSegment[];
      /**
       * The downloaded media covers clearly less than the video's expected
       * duration (ffmpeg probe < 80 % of the page duration): the transcript
       * is real but incomplete, so its summary must not be cached.
       */
      partial?: boolean;
    }
  | {
      type: 'OFFSCREEN_RESULT';
      jobId: string;
      ok: false;
      code: TldwErrorCode;
      message: string;
      /** Seconds to wait before retrying (RATE_LIMITED), when the provider said so. */
      retryAfter?: number;
    };

export const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

/**
 * Name of the `chrome.runtime.connect` port the offscreen document holds open
 * to the worker for the duration of a job (see src/offscreen/worker-link.ts):
 * its disconnection tells the offscreen document the worker died, so it
 * aborts instead of spending credits on a result nobody will receive.
 */
export const OFFSCREEN_PORT = 'tldw-offscreen-job';
