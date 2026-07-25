import type { DetectedVideo, Settings, Transcript } from '@/types';
import { TldwError } from '@/types';

/**
 * Audio fallback interface (F5) — level 2 of the cascade.
 *
 * This is the most delicate and fragile part of the project, so it is isolated
 * behind THIS stable interface and can be swapped without touching the rest of the
 * extension (spec §3.5 note). The full pipeline lands in Phase 3:
 *
 *   1. capture media segments (chrome.webRequest)
 *   2. download in the authenticated tab context
 *   3. isolate the audio track (ffmpeg.wasm)
 *   4. chunk with overlap (25 MB Whisper limit)
 *   5. transcribe sequentially, reassemble, de-duplicate overlaps
 *   6. normalize to Transcript
 *
 * Until then the stub fails cleanly with a typed error so the UI stays honest.
 */
export interface Transcriber {
  transcribe(
    video: DetectedVideo,
    settings: Settings,
    onProgress: (detail: string) => void,
    signal?: AbortSignal,
  ): Promise<Transcript>;
}

export const audioTranscriber: Transcriber = {
  async transcribe(_video, settings) {
    if (!settings.transcriptionKey) {
      throw new TldwError(
        'MISSING_TRANSCRIPTION_KEY',
        'Audio fallback requires a transcription API key.',
      );
    }
    // Phase 3 — not yet implemented.
    throw new TldwError(
      'MEDIA_NOT_CAPTURABLE',
      'Audio transcription fallback is not available yet (Phase 3).',
    );
  },
};
