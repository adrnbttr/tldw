import { TldwError } from '@/types';
import type { ProgressData } from '@/types';
import type { OffscreenProgressPhase, TranscribeJob } from '@/transcription/offscreen-protocol';
import {
  pickBestCandidate,
  isHlsMaster,
  isGoogleVideoUrl,
  pickHlsVariant,
  parseHlsMedia,
  parseVimeoMaster,
} from '@/transcription/media';
import type { VimeoMaster } from '@/transcription/media';
import { assertMediaSize } from '@/transcription/audio';
import { planByteRanges } from '@/transcription/ranges';
import { describeUrl } from '@/shared/safe-url';
import { createClientLogger } from '@/shared/logger-client';
import type { Messages } from '@/i18n';

/**
 * Media download for the offscreen pipeline (F5): resolves the best captured
 * source and brings it into one byte buffer.
 *
 * Memory: every path counts bytes as they arrive and fails with the typed
 * MEDIA_TOO_LARGE error the moment `MAX_MEDIA_BYTES` (transcription/audio.ts)
 * is crossed — before any
 * concatenation — and part lists are released right after assembly.
 *
 * Liveness: the worker times this phase with an inactivity timer, so every
 * path reports progress as bytes flow (per range block, per segment, and
 * every few seconds while a single body streams in).
 */

/** Offscreen logger — ships to the worker's buffer and echoes to DevTools. */
const log = createClientLogger('offscreen', { echo: true });

/**
 * Progress callback threaded through the pipeline: coarse phase (so the worker
 * can time each phase), localized detail, plus the resolved media duration once
 * extraction has probed it.
 */
export type ProgressFn = (
  phase: OffscreenProgressPhase,
  detail: string,
  duration?: number,
  data?: ProgressData,
) => void;

export interface DownloadContext {
  t: Messages['transcription'];
  progress: ProgressFn;
  /** Compact diagnostics, surfaced with a failure. */
  diag: string[];
  signal?: AbortSignal;
}

/** Minimum interval between two streaming progress reports. */
const STREAM_PROGRESS_INTERVAL_MS = 2000;

/** Host + coarse path shape (no query, no path tokens) — safe to show for diagnostics. */
export function safePath(url: string): string {
  return describeUrl(url) ?? '?';
}

/** Running byte count of one download, checked against `MAX_MEDIA_BYTES`. */
export class ByteBudget {
  used = 0;
  add(bytes: number): void {
    this.used += bytes;
    assertMediaSize(this.used);
  }
  /** Fails early when a known size would not fit next to what is already held. */
  reserve(bytes: number): void {
    assertMediaSize(this.used + bytes);
  }
}

/** Resolves and downloads the best media source into a single byte buffer. */
export async function downloadSource(
  job: TranscribeJob,
  ctx: DownloadContext,
): Promise<Uint8Array> {
  const { t, progress, diag } = ctx;
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
  log.info('captured sources', {
    sourceCount: job.sources.length,
    hosts: [...new Set(job.sources.map((s) => safePath(s.url).split('/')[0]))],
  });

  if (!best) {
    throw new TldwError('MEDIA_NOT_CAPTURABLE', 'No media source was captured.');
  }

  progress('download', t.fetchingMedia);

  if (best.kind === 'vimeo_master') {
    return downloadVimeoMaster(best.url, ctx);
  }

  if (best.kind === 'segment') {
    // A loose segment is a few seconds of a stream, not the video: never
    // transcribe it as if it were (the worker filters these out already).
    throw new TldwError(
      'MEDIA_NEEDS_PLAYBACK',
      'Only media segments were captured.',
      'the stream manifest was not captured',
    );
  }

  if (best.kind === 'progressive') {
    // Google Drive: googlevideo serves one whole file as byte ranges; fetch it
    // block by block (resumable, visible progress) instead of a single request.
    if (best.kind === 'progressive' && isGoogleVideoUrl(best.url)) {
      const ranged = await downloadByRanges(best.url, ctx);
      if (ranged) return ranged;
      // Range support broke mid-way — fall back to the single full GET.
    }
    return fetchBytes(best.url, ctx, new ByteBudget());
  }

  if (best.kind === 'hls') {
    let url = best.url;
    let playlist = await (await fetchAuth(url, ctx.signal)).text();

    // Master playlist → resolve to a media playlist (audio-only if available).
    if (isHlsMaster(playlist)) {
      const variant = pickHlsVariant(playlist, url);
      diag.push(`master→variant=${variant ? safePath(variant) : 'none'}`);
      if (!variant) {
        throw new TldwError('MEDIA_NOT_CAPTURABLE', 'No usable variant in HLS master.');
      }
      url = variant;
      playlist = await (await fetchAuth(url, ctx.signal)).text();
    }

    const { initUrl, segmentUrls } = parseHlsMedia(playlist, url);
    diag.push(`hls map=${initUrl ? 'yes' : 'no'} segs=${segmentUrls.length}`);
    if (segmentUrls.length === 0) {
      throw new TldwError('MEDIA_NOT_CAPTURABLE', 'HLS playlist had no segments.');
    }

    const budget = new ByteBudget();
    const parts: Uint8Array[] = [];
    // The fMP4 init segment MUST come first, or the fragments are undecodable.
    if (initUrl) parts.push(await fetchBytes(initUrl, ctx, budget));
    for (let i = 0; i < segmentUrls.length; i++) {
      progress('download', t.assembling(i + 1, segmentUrls.length), undefined, {
        done: i,
        total: segmentUrls.length,
        unit: 'items',
      });
      parts.push(await fetchBytes(segmentUrls[i], ctx, budget));
    }
    return concatAndRelease(parts);
  }

  // DASH and anything else are not assembled here.
  throw new TldwError('MEDIA_NOT_CAPTURABLE', `Unsupported media kind: ${best.kind}.`);
}

/** Block size for googlevideo range downloads (8–16 MiB sweet spot). */
const RANGE_BLOCK_BYTES = 8 * 1024 * 1024;

/**
 * Downloads a googlevideo source in fixed byte ranges (`Range: bytes=a-b`),
 * writing the blocks into one preallocated buffer and reporting progress, so a
 * large file arrives in resumable chunks instead of one giant request. If the
 * probe shows the server ignores ranges (200 instead of 206), the response
 * body already IS the whole file and is streamed in as-is. Returns null only
 * when range support looked fine but broke (no usable Content-Range, or a
 * non-206 block mid-download) — the caller then falls back to a single full GET.
 */
export async function downloadByRanges(
  url: string,
  ctx: DownloadContext,
): Promise<Uint8Array | null> {
  const { t, progress, diag } = ctx;
  // Probe with a 1-byte range: 206 + `Content-Range: bytes 0-0/TOTAL` proves
  // range support and reveals the total size.
  const probe = await fetchAuth(url, ctx.signal, { Range: 'bytes=0-0' });
  if (probe.status !== 206) {
    // Server ignored Range: this very response (200) is the full file — keep it
    // rather than re-downloading everything with a second full-GET fallback.
    log.info('ranges unsupported → single fetch', { status: probe.status });
    diag.push('ranges unsupported → single fetch');
    return readBody(probe, ctx, new ByteBudget());
  }
  await probe.arrayBuffer(); // 1-byte probe body — release the connection.
  const totalBytes = Number(
    probe.headers.get('content-range')?.match(/^bytes \d+-\d+\/(\d+)$/i)?.[1],
  );
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    log.info('ranges no total → full fetch');
    diag.push('ranges no total → full fetch');
    return null;
  }
  assertMediaSize(totalBytes);

  const ranges = planByteRanges(totalBytes, RANGE_BLOCK_BYTES);
  log.info('ranges planned', { totalBytes, blocks: ranges.length });
  diag.push(`ranges total=${mb(totalBytes)}MB blocks=${ranges.length}`);

  // Preallocated destination: each block lands at its own offset, no giant concat.
  const out = new Uint8Array(totalBytes);
  for (const [start, end] of ranges) {
    const res = await fetchAuth(url, ctx.signal, { Range: `bytes=${start}-${end}` });
    if (res.status !== 206) {
      log.warn('range fetch not partial → full fetch', { status: res.status, start, end });
      diag.push(`range status=${res.status} → full fetch`);
      return null;
    }
    // Streamed, not `arrayBuffer()`: on a slow link one 8 MiB block can take
    // minutes, and the worker's inactivity timer needs progress while it flows.
    const block = await readBody(res, ctx, new ByteBudget(), (received) => {
      const done = start + received;
      progress('download', t.downloading(mb(done), mb(totalBytes)), undefined, {
        done,
        total: totalBytes,
        unit: 'bytes',
      });
    });
    if (block.byteLength !== end - start + 1) {
      throw new TldwError(
        'MEDIA_NOT_CAPTURABLE',
        `Range ${start}-${end} returned ${block.byteLength} bytes.`,
      );
    }
    out.set(block, start);
    log.debug('range fetched', { start, end, bytes: block.byteLength });
    progress('download', t.downloading(mb(end + 1), mb(totalBytes)), undefined, {
      done: end + 1,
      total: totalBytes,
      unit: 'bytes',
    });
  }
  return out;
}

/** Rounds a byte count to MiB with one decimal (progress labels, diagnostics). */
function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

/** Reconstructs a playable fMP4 from a Vimeo DASH master.json (init + segments). */
async function downloadVimeoMaster(masterUrl: string, ctx: DownloadContext): Promise<Uint8Array> {
  const { t, progress, diag } = ctx;
  // Force base64_init so the init segment is inlined in the manifest.
  const url = /base64_init=1/.test(masterUrl)
    ? masterUrl
    : masterUrl + (masterUrl.includes('?') ? '&' : '?') + 'base64_init=1';

  const master = (await (await fetchAuth(url, ctx.signal)).json()) as VimeoMaster;
  const { initBase64, segmentUrls } = parseVimeoMaster(master, url);
  diag.push(`vimeo-master init=${initBase64 ? 'yes' : 'no'} segs=${segmentUrls.length}`);

  if (!initBase64 || segmentUrls.length === 0) {
    throw new TldwError('MEDIA_NOT_CAPTURABLE', 'master.json had no init/segments.');
  }

  const budget = new ByteBudget();
  const init = base64ToBytes(initBase64);
  budget.add(init.byteLength);
  const parts: Uint8Array[] = [init];
  for (let i = 0; i < segmentUrls.length; i++) {
    progress('download', t.assembling(i + 1, segmentUrls.length), undefined, {
      done: i,
      total: segmentUrls.length,
      unit: 'items',
    });
    parts.push(await fetchBytes(segmentUrls[i], ctx, budget));
  }
  return concatAndRelease(parts);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function fetchAuth(
  url: string,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<Response> {
  const res = await fetch(url, { credentials: 'include', headers, signal });
  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      throw new TldwError('MEDIA_PROTECTED', `Media request returned ${res.status}.`);
    }
    throw new TldwError('MEDIA_NOT_CAPTURABLE', `Media request returned ${res.status}.`);
  }
  return res;
}

async function fetchBytes(
  url: string,
  ctx: DownloadContext,
  budget: ByteBudget,
): Promise<Uint8Array> {
  return readBody(await fetchAuth(url, ctx.signal), ctx, budget);
}

/**
 * Streams a response body in, counting bytes against `budget` (fails typed the
 * moment the limit is crossed, cancelling the stream) and reporting progress at
 * most every couple of seconds — through `onProgress` (bytes received so far)
 * when given, else as a generic download message. A known Content-Length is
 * checked up front and lets the body land straight in a preallocated buffer.
 */
export async function readBody(
  res: Response,
  ctx: DownloadContext,
  budget: ByteBudget,
  onProgress?: (received: number) => void,
): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  const known = Number.isFinite(declared) && declared > 0 ? declared : null;
  if (known != null) budget.reserve(known);

  const reader = res.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    budget.add(bytes.byteLength);
    return bytes;
  }

  let received = 0;
  let lastReport = Date.now();
  let preallocated: Uint8Array | null = known != null ? new Uint8Array(known) : null;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      budget.add(value.byteLength);
      if (preallocated && received + value.byteLength <= preallocated.byteLength) {
        preallocated.set(value, received);
      } else {
        // Body longer than announced: keep what landed, continue as parts.
        if (preallocated) {
          parts.push(preallocated.subarray(0, received));
          preallocated = null;
        }
        parts.push(value);
      }
      received += value.byteLength;
      const now = Date.now();
      if (now - lastReport >= STREAM_PROGRESS_INTERVAL_MS) {
        lastReport = now;
        if (onProgress) onProgress(received);
        else
          ctx.progress(
            'download',
            known != null ? ctx.t.downloading(mb(received), mb(known)) : ctx.t.fetchingMedia,
            undefined,
            known != null ? { done: received, total: known, unit: 'bytes' } : undefined,
          );
      }
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }

  if (preallocated) {
    return received === preallocated.byteLength ? preallocated : preallocated.slice(0, received);
  }
  return concatAndRelease(parts);
}

/** Concatenates then empties `parts`, so the pieces can be collected right away. */
function concatAndRelease(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  assertMediaSize(total);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  parts.length = 0;
  return out;
}
