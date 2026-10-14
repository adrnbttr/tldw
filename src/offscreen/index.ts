import type { TranscriptSegment } from '@/types';
import { TldwError } from '@/types';
import type {
  OffscreenRequest,
  OffscreenResponse,
  TranscribeJob,
} from '@/transcription/offscreen-protocol';
import {
  pickBestCandidate,
  isHlsMaster,
  isGoogleVideoUrl,
  pickHlsVariant,
  parseHlsMedia,
  parseVimeoMaster,
} from '@/transcription/media';
import type { VimeoMaster } from '@/transcription/media';
import { FfmpegAudio, AUDIO_BYTES_PER_SECOND } from '@/transcription/audio';
import { planChunks, mergeChunkTranscripts } from '@/transcription/chunker';
import { planByteRanges } from '@/transcription/ranges';
import { transcribeAudio } from '@/transcription/whisper';
import { transcribeViaOpenRouter } from '@/transcription/openrouter-audio';
import { getCatalog, isLocale } from '@/i18n';
import type { Messages } from '@/i18n';

/**
 * Offscreen document (F5).
 *
 * Runs the full audio-fallback pipeline off the service worker:
 *   resolve media source → download → extract mono MP3 → chunk → transcribe → merge.
 * Transcription uses OpenRouter (Gemini) by default, or OpenAI Whisper. Progress
 * and the terminal result are posted back to the worker.
 */

const audio = new FfmpegAudio();

chrome.runtime.onMessage.addListener((message: OffscreenRequest) => {
  if (message.type === 'OFFSCREEN_TRANSCRIBE') {
    void runJob(message.job);
  }
  return false;
});

function report(msg: OffscreenResponse): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    /* worker gone — nothing to do */
  });
}

async function runJob(job: TranscribeJob): Promise<void> {
  const t = getCatalog(isLocale(job.uiLanguage) ? job.uiLanguage : 'en').transcription;
  const progress = (detail: string) =>
    report({ type: 'OFFSCREEN_PROGRESS', videoId: job.videoId, detail });
  const diag: string[] = [];

  try {
    const mediaBytes = await downloadSource(job, t, progress, diag);

    progress(t.extractingAudio);
    const mp3 = await audio.toMonoMp3(mediaBytes, 'input.media');
    const duration = job.duration ?? estimateDuration(mp3.byteLength);

    const { language, segments } =
      job.transcriptionProvider === 'openrouter'
        ? await transcribeWithOpenRouter(job, mp3, duration, t, progress)
        : await transcribeWithWhisper(job, mp3, duration, t, progress);

    audio.terminate();
    report({ type: 'OFFSCREEN_RESULT', videoId: job.videoId, ok: true, language, segments });
  } catch (err) {
    audio.terminate();
    const code = err instanceof TldwError ? err.code : 'UNKNOWN';
    // Carry the technical detail (ffmpeg/API) + source diagnostics so the popup
    // can show exactly what the host served.
    const base = err instanceof TldwError ? (err.providerMessage ?? '') : String(err);
    const detail = [diag.join(' '), base].filter(Boolean).join(' ‹ ');
    console.error('[tldw] audio fallback failed', { code, detail, sources: job.sources });
    report({ type: 'OFFSCREEN_RESULT', videoId: job.videoId, ok: false, code, message: detail });
  }
}

/** Pathname only (no query/token) — safe to show for diagnostics. */
function safePath(url: string): string {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return '?';
  }
}

interface TranscriptResult {
  language: string;
  segments: TranscriptSegment[];
}

/** OpenRouter (Gemini) path: plain-text transcript, no overlap, one segment/chunk. */
async function transcribeWithOpenRouter(
  job: TranscribeJob,
  mp3: Uint8Array,
  duration: number,
  t: Messages['transcription'],
  progress: (detail: string) => void,
): Promise<TranscriptResult> {
  const chunks = planChunks({
    durationSeconds: duration,
    bytesPerSecond: AUDIO_BYTES_PER_SECOND,
    overlapSeconds: 0,
  });

  const segments: TranscriptSegment[] = [];
  for (const chunk of chunks) {
    progress(
      chunks.length === 1
        ? t.transcribingOne
        : t.transcribing(chunk.index + 1, chunks.length, formatClock(chunk.start)),
    );
    const slice = chunks.length === 1 ? mp3 : await audio.slice(mp3, chunk.start, chunk.end);
    const text = await transcribeViaOpenRouter(slice, {
      apiKey: job.openRouterKey,
      model: job.audioModel,
      language: job.language,
    });
    if (text) segments.push({ start: chunk.start, end: chunk.end, text });
  }

  return { language: job.language, segments };
}

/** OpenAI Whisper path: per-segment timings, overlap, reassembled + de-duplicated. */
async function transcribeWithWhisper(
  job: TranscribeJob,
  mp3: Uint8Array,
  duration: number,
  t: Messages['transcription'],
  progress: (detail: string) => void,
): Promise<TranscriptResult> {
  const chunks = planChunks({ durationSeconds: duration, bytesPerSecond: AUDIO_BYTES_PER_SECOND });

  const perChunkSegments: TranscriptSegment[][] = [];
  const offsets: number[] = [];
  let language = job.language;

  for (const chunk of chunks) {
    progress(
      chunks.length === 1
        ? t.transcribingOne
        : t.transcribing(chunk.index + 1, chunks.length, formatClock(chunk.start)),
    );
    const slice = chunks.length === 1 ? mp3 : await audio.slice(mp3, chunk.start, chunk.end);
    const result = await transcribeAudio(
      new Blob([slice as BlobPart]),
      `chunk-${chunk.index}.mp3`,
      {
        apiKey: job.transcriptionKey,
        model: job.whisperModel,
        language: job.language,
      },
    );
    language = result.language || language;
    perChunkSegments.push(result.segments);
    offsets.push(chunk.start);
  }

  return { language, segments: mergeChunkTranscripts(perChunkSegments, offsets) };
}

/** Resolves and downloads the best media source into a single byte buffer. */
async function downloadSource(
  job: TranscribeJob,
  t: Messages['transcription'],
  progress: (detail: string) => void,
  diag: string[],
): Promise<Uint8Array> {
  const best = pickBestCandidate(job.sources);

  // Compact diagnostics (most useful first, so it survives truncation).
  const counts: Record<string, number> = {};
  for (const s of job.sources) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  const sample = job.sources.find((s) => s.kind !== 'segment') ?? job.sources[0];
  if (sample) diag.push(`sample=${sample.kind}:${safePath(sample.url)}`);
  diag.push(
    `kinds=${
      Object.entries(counts)
        .map(([k, n]) => `${k}×${n}`)
        .join(',') || 'none'
    }`,
  );
  console.log(
    '[tldw] captured sources',
    job.sources.map((s) => `${s.kind} ${safePath(s.url)}`),
  );

  if (!best) {
    throw new TldwError('MEDIA_NOT_CAPTURABLE', 'No media source was captured.');
  }

  progress(t.fetchingMedia);

  if (best.kind === 'vimeo_master') {
    return downloadVimeoMaster(best.url, t, progress, diag);
  }

  if (best.kind === 'progressive' || best.kind === 'segment') {
    // Google Drive: googlevideo serves one whole file as byte ranges; fetch it
    // block by block (resumable, visible progress) instead of a single request.
    if (best.kind === 'progressive' && isGoogleVideoUrl(best.url)) {
      const ranged = await downloadByRanges(best.url, t, progress, diag);
      if (ranged) return ranged;
      // Range support broke mid-way — fall back to the single full GET.
    }
    return fetchBytes(best.url);
  }

  if (best.kind === 'hls') {
    let url = best.url;
    let playlist = await (await fetchAuth(url)).text();

    // Master playlist → resolve to a media playlist (audio-only if available).
    if (isHlsMaster(playlist)) {
      const variant = pickHlsVariant(playlist, url);
      diag.push(`master→variant=${variant ? safePath(variant) : 'none'}`);
      if (!variant) {
        throw new TldwError('MEDIA_NOT_CAPTURABLE', 'No usable variant in HLS master.');
      }
      url = variant;
      playlist = await (await fetchAuth(url)).text();
    }

    const { initUrl, segmentUrls } = parseHlsMedia(playlist, url);
    diag.push(`hls map=${initUrl ? 'yes' : 'no'} segs=${segmentUrls.length}`);
    if (segmentUrls.length === 0) {
      throw new TldwError('MEDIA_NOT_CAPTURABLE', 'HLS playlist had no segments.');
    }

    const parts: Uint8Array[] = [];
    // The fMP4 init segment MUST come first, or the fragments are undecodable.
    if (initUrl) parts.push(await fetchBytes(initUrl));
    for (let i = 0; i < segmentUrls.length; i++) {
      progress(t.assembling(i + 1, segmentUrls.length));
      parts.push(await fetchBytes(segmentUrls[i]));
    }
    return concat(parts);
  }

  // DASH and anything else are not assembled here.
  throw new TldwError('MEDIA_NOT_CAPTURABLE', `Unsupported media kind: ${best.kind}.`);
}

/** Block size for googlevideo range downloads (8–16 MiB sweet spot). */
const RANGE_BLOCK_BYTES = 8 * 1024 * 1024;

/**
 * Downloads a googlevideo source in fixed byte ranges (`Range: bytes=a-b`),
 * concatenating the blocks and reporting progress, so a large file arrives in
 * resumable chunks instead of one giant request. If the probe shows the server
 * ignores ranges (200 instead of 206), the response body already IS the whole
 * file and is returned as-is. Returns null only when range support looked fine
 * but broke (no usable Content-Range, or a non-206 block mid-download) — the
 * caller then falls back to a single full GET.
 */
async function downloadByRanges(
  url: string,
  t: Messages['transcription'],
  progress: (detail: string) => void,
  diag: string[],
): Promise<Uint8Array | null> {
  // Probe with a 1-byte range: 206 + `Content-Range: bytes 0-0/TOTAL` proves
  // range support and reveals the total size.
  const probe = await fetchAuth(url, { Range: 'bytes=0-0' });
  if (probe.status !== 206) {
    // Server ignored Range: this very response (200) is the full file — keep it
    // rather than re-downloading everything with a second full-GET fallback.
    diag.push('ranges unsupported → single fetch');
    return new Uint8Array(await probe.arrayBuffer());
  }
  await probe.arrayBuffer(); // 1-byte probe body — release the connection.
  const totalBytes = Number(
    probe.headers.get('content-range')?.match(/^bytes \d+-\d+\/(\d+)$/i)?.[1],
  );
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    diag.push('ranges no total → full fetch');
    return null;
  }

  const ranges = planByteRanges(totalBytes, RANGE_BLOCK_BYTES);
  diag.push(`ranges total=${mb(totalBytes)}MB blocks=${ranges.length}`);

  const parts: Uint8Array[] = [];
  for (const [start, end] of ranges) {
    const res = await fetchAuth(url, { Range: `bytes=${start}-${end}` });
    if (res.status !== 206) {
      diag.push(`range status=${res.status} → full fetch`);
      return null;
    }
    const block = new Uint8Array(await res.arrayBuffer());
    if (block.byteLength !== end - start + 1) {
      throw new TldwError(
        'MEDIA_NOT_CAPTURABLE',
        `Range ${start}-${end} returned ${block.byteLength} bytes.`,
      );
    }
    parts.push(block);
    progress(t.downloading(mb(end + 1), mb(totalBytes)));
  }
  return concat(parts);
}

/** Rounds a byte count to MiB with one decimal (progress labels, diagnostics). */
function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

/** Reconstructs a playable fMP4 from a Vimeo DASH master.json (init + segments). */
async function downloadVimeoMaster(
  masterUrl: string,
  t: Messages['transcription'],
  progress: (detail: string) => void,
  diag: string[],
): Promise<Uint8Array> {
  // Force base64_init so the init segment is inlined in the manifest.
  const url = /base64_init=1/.test(masterUrl)
    ? masterUrl
    : masterUrl + (masterUrl.includes('?') ? '&' : '?') + 'base64_init=1';

  const master = (await (await fetchAuth(url)).json()) as VimeoMaster;
  const { initBase64, segmentUrls } = parseVimeoMaster(master, url);
  diag.push(`vimeo-master init=${initBase64 ? 'yes' : 'no'} segs=${segmentUrls.length}`);

  if (!initBase64 || segmentUrls.length === 0) {
    throw new TldwError('MEDIA_NOT_CAPTURABLE', 'master.json had no init/segments.');
  }

  const parts: Uint8Array[] = [base64ToBytes(initBase64)];
  for (let i = 0; i < segmentUrls.length; i++) {
    progress(t.assembling(i + 1, segmentUrls.length));
    parts.push(await fetchBytes(segmentUrls[i]));
  }
  return concat(parts);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function fetchAuth(url: string, headers?: Record<string, string>): Promise<Response> {
  const res = await fetch(url, { credentials: 'include', headers });
  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      throw new TldwError('MEDIA_PROTECTED', `Media request returned ${res.status}.`);
    }
    throw new TldwError('MEDIA_NOT_CAPTURABLE', `Media request returned ${res.status}.`);
  }
  return res;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetchAuth(url)).arrayBuffer());
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function estimateDuration(byteLength: number): number {
  return Math.max(1, Math.round(byteLength / AUDIO_BYTES_PER_SECOND));
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
