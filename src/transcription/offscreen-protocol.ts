import type { TranscriptSegment, TldwErrorCode } from '@/types';
import type { MediaCandidate } from './media';

/**
 * Messaging contract between the service worker and the offscreen document.
 *
 * The heavy audio work (ffmpeg.wasm + Whisper) runs in the offscreen document
 * because the MV3 service worker has no DOM. The worker sends a job and receives
 * progress plus a terminal result.
 */

export interface TranscribeJob {
  videoId: string;
  provider: string;
  title: string | null;
  /** Known duration in seconds, if any (helps chunk planning). */
  duration: number | null;
  language: string;
  transcriptionKey: string;
  whisperModel: string;
  /** Candidate media sources to try, best-first. */
  sources: MediaCandidate[];
}

export type OffscreenRequest = { type: 'OFFSCREEN_TRANSCRIBE'; job: TranscribeJob };

export type OffscreenResponse =
  | { type: 'OFFSCREEN_PROGRESS'; videoId: string; detail: string }
  | {
      type: 'OFFSCREEN_RESULT';
      videoId: string;
      ok: true;
      language: string;
      segments: TranscriptSegment[];
    }
  | {
      type: 'OFFSCREEN_RESULT';
      videoId: string;
      ok: false;
      code: TldwErrorCode;
      message: string;
    };

export const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
