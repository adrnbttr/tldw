import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { TldwError } from '@/types';

/**
 * Audio extraction with ffmpeg.wasm (F5.3).
 *
 * Runs inside the offscreen document (the service worker has no DOM). The core is
 * self-hosted from `public/ffmpeg` and loaded via same-origin blob URLs — the
 * single-threaded build avoids SharedArrayBuffer / COOP-COEP requirements.
 *
 * Strategy: decode the source once into a compact mono 16 kHz MP3, then slice that
 * MP3 per chunk (cheap, no re-decode). Output stays small enough for Whisper.
 */

const AUDIO_BITRATE_KBPS = 64;
/** Bytes per second of the extracted mono MP3, for chunk planning. */
export const AUDIO_BYTES_PER_SECOND = (AUDIO_BITRATE_KBPS * 1000) / 8;

export class FfmpegAudio {
  private ffmpeg = new FFmpeg();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    const base = chrome.runtime.getURL('ffmpeg');
    try {
      await this.ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        classWorkerURL: await toBlobURL(`${base}/814.ffmpeg.js`, 'text/javascript'),
      });
      this.loaded = true;
    } catch (err) {
      throw new TldwError('AUDIO_EXTRACTION_FAILED', 'Failed to load ffmpeg.wasm.', String(err));
    }
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
      await this.cleanup([inputName, 'output.mp3']);
      return out as Uint8Array;
    } catch (err) {
      throw new TldwError('AUDIO_EXTRACTION_FAILED', 'Audio extraction failed.', String(err));
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
      throw new TldwError('AUDIO_EXTRACTION_FAILED', 'Audio slicing failed.', String(err));
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
