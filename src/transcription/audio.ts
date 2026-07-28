import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { TldwError } from '@/types';

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
 * Strategy: decode the source once into a compact mono 16 kHz MP3, then slice that
 * MP3 per chunk (cheap, no re-decode).
 */

const AUDIO_BITRATE_KBPS = 64;
/** Bytes per second of the extracted mono MP3, for chunk planning. */
export const AUDIO_BYTES_PER_SECOND = (AUDIO_BITRATE_KBPS * 1000) / 8;

export class FfmpegAudio {
  private ffmpeg = new FFmpeg();
  private loaded = false;
  /** Last few ffmpeg log lines, surfaced on failure for diagnosis. */
  private log: string[] = [];

  async load(): Promise<void> {
    if (this.loaded) return;
    const base = chrome.runtime.getURL('ffmpeg');
    this.ffmpeg.on('log', ({ message }) => {
      this.log.push(message);
      if (this.log.length > 12) this.log.shift();
      console.debug('[tldw ffmpeg]', message);
    });
    try {
      // No classWorkerURL → use the module worker Vite bundled (same-origin, CSP-ok).
      await this.ffmpeg.load({
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: `${base}/ffmpeg-core.wasm`,
      });
      this.loaded = true;
    } catch (err) {
      console.error('[tldw] ffmpeg failed to load', err);
      throw new TldwError('AUDIO_EXTRACTION_FAILED', 'Failed to load ffmpeg.wasm.', String(err));
    }
  }

  /** Recent ffmpeg log lines (for error diagnosis). */
  private tail(): string {
    return this.log.slice(-4).join(' | ');
  }

  /** Decodes an arbitrary media input into a full mono 16 kHz MP3. */
  async toMonoMp3(input: Uint8Array | string, inputName: string): Promise<Uint8Array> {
    await this.load();
    try {
      // fetchFile is for URLs/Blobs; raw bytes go straight to writeFile.
      const data = typeof input === 'string' ? await fetchFile(input) : input;
      await this.ffmpeg.writeFile(inputName, data);
      await this.ffmpeg.exec([
        '-i',
        inputName,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        `${AUDIO_BITRATE_KBPS}k`,
        'output.mp3',
      ]);
      const out = await this.ffmpeg.readFile('output.mp3');
      if (!out || (out as Uint8Array).byteLength === 0) {
        throw new Error('empty output — the input had no decodable audio track');
      }
      await this.cleanup([inputName, 'output.mp3']);
      return out as Uint8Array;
    } catch (err) {
      throw new TldwError(
        'AUDIO_EXTRACTION_FAILED',
        'Audio extraction failed.',
        `${err} ${this.tail()}`.trim(),
      );
    }
  }

  /** Slices a time range out of an MP3 without re-encoding. */
  async slice(mp3: Uint8Array, start: number, end: number): Promise<Uint8Array> {
    await this.load();
    const inName = 'full.mp3';
    const outName = `chunk-${start}-${end}.mp3`;
    try {
      await this.ffmpeg.writeFile(inName, mp3);
      await this.ffmpeg.exec([
        '-ss',
        String(start),
        '-to',
        String(end),
        '-i',
        inName,
        '-c',
        'copy',
        outName,
      ]);
      const data = (await this.ffmpeg.readFile(outName)) as Uint8Array;
      await this.cleanup([inName, outName]);
      return data;
    } catch (err) {
      throw new TldwError(
        'AUDIO_EXTRACTION_FAILED',
        'Audio slicing failed.',
        `${err} ${this.tail()}`.trim(),
      );
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
      this.ffmpeg.terminate();
    } catch {
      // ignore
    }
    this.loaded = false;
  }
}
