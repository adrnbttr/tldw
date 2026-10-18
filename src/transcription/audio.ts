import { FFmpeg } from '@ffmpeg/ffmpeg';
import { TldwError } from '@/types';
import { createClientLogger } from '@/shared/logger-client';

/**
 * Audio extraction with ffmpeg.wasm (F5.3).
 *
 * Runs inside the offscreen document (the service worker has no DOM).
 *
 * Loading under the extension CSP (`script-src 'self' 'wasm-unsafe-eval'`): the
 * class worker is the module worker Vite bundles for us (same-origin, so it passes
 * CSP — a blob: worker would not). The single-threaded ESM core is self-hosted in
 * `public/ffmpeg` and loaded from its same-origin chrome-extension:// URL via the
 * worker's dynamic import(); no SharedArrayBuffer, so no COOP/COEP needed.
 *
 * Strategy: the source is written once into the ffmpeg FS, then extracted one
 * time window at a time as a compact mono 16 kHz MP3 — the video bytes and a
 * full-length MP3 never coexist in memory.
 */

/** Offscreen logger — ships to the worker's buffer and echoes to DevTools. */
const log = createClientLogger('offscreen', { echo: true });

const AUDIO_BITRATE_KBPS = 64;
/** Bytes per second of the extracted mono MP3, for window planning. */
export const AUDIO_BYTES_PER_SECOND = (AUDIO_BITRATE_KBPS * 1000) / 8;

/**
 * Upper bound on the source media we accept to load. The peak is ≈ 2× the
 * source: the downloaded buffer is transferred to the ffmpeg worker, whose
 * MEMFS `writeFile` stores its own copy (and assembling HLS/Vimeo parts or a
 * streamed body briefly holds parts + result too). 1 GiB keeps that peak
 * around 2 GiB — what one extension renderer can reliably get. Downloads
 * check the running byte count against it and abort as soon as it is
 * exceeded, before any concatenation.
 */
export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;

/** Fails clean when the media would exceed the memory budget (F5 rule). */
export function assertMediaSize(bytes: number): void {
  if (bytes > MAX_MEDIA_BYTES) {
    throw new TldwError(
      'MEDIA_TOO_LARGE',
      'The video is too large to process in memory.',
      `${Math.round(bytes / (1024 * 1024))} MB exceeds the ${Math.round(
        MAX_MEDIA_BYTES / (1024 * 1024),
      )} MB limit`,
    );
  }
}

/** One planned extraction window of the source media. */
export interface AudioWindow {
  index: number;
  /** Start offset in seconds. */
  start: number;
  /** End offset in seconds. */
  end: number;
}

export interface AudioWindowOptions {
  /** Total media duration in seconds. */
  durationSeconds: number;
  /** Estimated bytes per second of the extracted audio. */
  bytesPerSecond: number;
  /** Max bytes per extracted window (default 24 MB, under the 25 MB Whisper limit). */
  maxBytes?: number;
  /** Overlap between consecutive windows, in seconds (default 5). */
  overlapSeconds?: number;
}

/**
 * Plans source-media time windows whose extracted mono MP3 stays under the
 * transcription size limit, with a few seconds of overlap so no sentence is cut
 * at a boundary.
 */
export function planAudioWindows(options: AudioWindowOptions): AudioWindow[] {
  const {
    durationSeconds,
    bytesPerSecond,
    maxBytes = 24 * 1024 * 1024,
    overlapSeconds = 5,
  } = options;

  if (durationSeconds <= 0 || bytesPerSecond <= 0) return [];

  const maxWindowSeconds = Math.max(overlapSeconds + 1, Math.floor(maxBytes / bytesPerSecond));

  // Single window covers the whole media.
  if (durationSeconds <= maxWindowSeconds) {
    return [{ index: 0, start: 0, end: durationSeconds }];
  }

  const windows: AudioWindow[] = [];
  let start = 0;
  let index = 0;
  while (start < durationSeconds) {
    const end = Math.min(start + maxWindowSeconds, durationSeconds);
    windows.push({ index, start, end });
    if (end >= durationSeconds) break;
    start = end - overlapSeconds;
    index++;
  }
  return windows;
}

const DURATION_RE = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

/** Parses `Duration: HH:MM:SS.xx` out of an ffmpeg log; `N/A` or absent → null. */
export function parseFfmpegDuration(log: string): number | null {
  const m = DURATION_RE.exec(log);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** The single source file kept inside the ffmpeg FS. */
const SOURCE_NAME = 'source.media';

/**
 * Bounded tail of ffmpeg's stderr, kept locally for error detail. Metadata
 * lines (titles, GPS `location`, `com.apple.*`, encoder…) are dropped on the
 * way in: the tail can end up in a user-pasted diagnostic.
 */
export class FfmpegLogTail {
  private lines: string[] = [];
  private inMetadata = false;

  constructor(private readonly max = 12) {}

  push(message: string): void {
    if (/^\s*Metadata:\s*$/i.test(message)) {
      this.inMetadata = true;
      return;
    }
    if (this.inMetadata && /^\s{4,}\S/.test(message)) return;
    this.inMetadata = false;
    if (
      /^\s*(location(-\w+)?|title|comment|artist|album|encoder|com\.apple\.[\w.-]+)\s*:/i.test(
        message,
      )
    )
      return;
    this.lines.push(message);
    if (this.lines.length > this.max) this.lines.shift();
  }

  recent(n: number): string {
    return this.lines.slice(-n).join(' | ');
  }
}

export class FfmpegAudio {
  private ffmpeg = new FFmpeg();
  private loaded = false;
  /** Last few ffmpeg log lines, surfaced on failure for diagnosis. */
  private log = new FfmpegLogTail();

  /**
   * Local tail only, metadata filtered out (GPS location, titles…): the stream
   * itself is never forwarded to the shared log buffer.
   */
  private onTailLog = ({ message }: { message: string }): void => {
    this.log.push(message);
  };

  async load(): Promise<void> {
    if (this.loaded) return;
    const base = chrome.runtime.getURL('ffmpeg');
    // Idempotent: a reload after terminate() must not stack a second listener.
    this.ffmpeg.off('log', this.onTailLog);
    this.ffmpeg.on('log', this.onTailLog);
    const started = performance.now();
    try {
      // No classWorkerURL → use the module worker Vite bundled (same-origin, CSP-ok).
      await this.ffmpeg.load({
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: `${base}/ffmpeg-core.wasm`,
      });
      this.loaded = true;
      log.info('ffmpeg loaded', { ms: Math.round(performance.now() - started) });
    } catch (err) {
      log.error('ffmpeg failed to load', err);
      throw new TldwError('AUDIO_EXTRACTION_FAILED', 'Failed to load ffmpeg.wasm.', String(err));
    }
  }

  /** Recent ffmpeg log lines (for error diagnosis). */
  private tail(): string {
    return this.log.recent(4);
  }

  /** Writes the whole media into the ffmpeg FS as a single file; returns its name. */
  async writeSource(data: Uint8Array): Promise<string> {
    await this.load();
    try {
      await this.ffmpeg.writeFile(SOURCE_NAME, data);
      return SOURCE_NAME;
    } catch (err) {
      throw new TldwError(
        'AUDIO_EXTRACTION_FAILED',
        'Loading the media into ffmpeg failed.',
        `${err} ${this.tail()}`.trim(),
      );
    }
  }

  /** Removes the source file from the ffmpeg FS; never throws (F5 cleanup rule). */
  async removeSource(): Promise<void> {
    await this.cleanup([SOURCE_NAME]);
  }

  /**
   * Probes the container duration via `ffmpeg -i` — no output file, so ffmpeg
   * exits non-zero right after logging the input header. null when unknown.
   */
  async probeDuration(name: string): Promise<number | null> {
    await this.load();
    const lines: string[] = [];
    const onLog = ({ message }: { message: string }): void => {
      lines.push(message);
    };
    this.ffmpeg.on('log', onLog);
    try {
      await this.ffmpeg.exec(['-i', name]);
    } finally {
      this.ffmpeg.off('log', onLog);
    }
    return parseFfmpegDuration(lines.join('\n'));
  }

  /**
   * Extracts `[start, end)` of the source as a mono 16 kHz MP3 window. Returns
   * null when the output is under half a second's worth of bytes — the stream
   * ended before this window, so the caller can stop the loop.
   */
  async extractWindow(name: string, start: number, end: number): Promise<Uint8Array | null> {
    await this.load();
    const outName = 'window.mp3';
    const started = performance.now();
    try {
      // -ss before -i: ffmpeg seeks straight into the source (no full decode).
      const code = await this.ffmpeg.exec([
        '-ss',
        String(start),
        '-t',
        String(end - start),
        '-i',
        name,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        `${AUDIO_BITRATE_KBPS}k`,
        outName,
      ]);
      if (code !== 0) {
        throw new Error(`ffmpeg exited with code ${code}`);
      }
      const out = (await this.ffmpeg.readFile(outName)) as Uint8Array;
      if (!out || out.byteLength < AUDIO_BYTES_PER_SECOND / 2) return null;
      log.debug('audio window extracted', {
        start,
        end,
        bytes: out.byteLength,
        ms: Math.round(performance.now() - started),
      });
      return out;
    } catch (err) {
      throw new TldwError(
        'AUDIO_EXTRACTION_FAILED',
        'Audio extraction failed.',
        `${err} ${this.tail()}`.trim(),
      );
    } finally {
      await this.cleanup([outName]);
    }
  }

  /** Deletes temp files from the in-memory FS; never throws (F5 cleanup rule). */
  private async cleanup(names: string[]): Promise<void> {
    for (const name of names) {
      try {
        await this.ffmpeg.deleteFile(name);
      } catch {
        // Already gone — ignore.
      }
    }
  }

  terminate(): void {
    try {
      this.ffmpeg.off('log', this.onTailLog);
      this.ffmpeg.terminate();
    } catch {
      // ignore
    }
    this.loaded = false;
  }
}
