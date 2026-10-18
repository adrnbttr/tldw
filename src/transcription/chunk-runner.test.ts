import { describe, expect, it, vi } from 'vitest';
import type { ChunkPlan } from './chunker';
import { transcribeChunks } from './chunk-runner';
import type { ChunkRunnerDeps } from './chunk-runner';

const chunks: ChunkPlan[] = [
  { index: 0, start: 0, end: 720 },
  { index: 1, start: 720, end: 1440 },
  { index: 2, start: 1440, end: 2160 },
];

const audio = new Uint8Array(8);

function deps(over: Partial<ChunkRunnerDeps> = {}): ChunkRunnerDeps {
  return {
    extract: vi.fn(async () => audio),
    transcribe: vi.fn(async () => ({ text: 'words', truncated: false })),
    log: { info: vi.fn(), warn: vi.fn() },
    ...over,
  };
}

describe('transcribeChunks', () => {
  it('transcribes every chunk in order', async () => {
    const d = deps();
    await expect(transcribeChunks(chunks, d)).resolves.toEqual(['words', 'words', 'words']);
  });

  it('stops at the first empty window past the start (stream ended)', async () => {
    const extract = vi
      .fn()
      .mockResolvedValueOnce(audio)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(audio);
    const d = deps({ extract });
    await expect(transcribeChunks(chunks, d)).resolves.toEqual(['words']);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('fails typed when the very first window is empty (no audio track)', async () => {
    const d = deps({ extract: vi.fn(async () => null) });
    await expect(transcribeChunks(chunks, d)).rejects.toMatchObject({
      code: 'AUDIO_EXTRACTION_FAILED',
    });
  });

  it('keeps an empty chunk as empty instead of failing the job', async () => {
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({ text: 'a', truncated: false })
      .mockResolvedValueOnce({ text: '', truncated: false })
      .mockResolvedValueOnce({ text: 'c', truncated: false });
    const d = deps({ transcribe });
    await expect(transcribeChunks(chunks, d)).resolves.toEqual(['a', '', 'c']);
    expect(d.log.info).toHaveBeenCalledWith('chunks transcribed', {
      total: 3,
      transcribed: 3,
      empty: 1,
    });
  });

  it('fails only when every chunk came back empty', async () => {
    const d = deps({ transcribe: vi.fn(async () => ({ text: ' ', truncated: false })) });
    await expect(transcribeChunks(chunks, d)).rejects.toMatchObject({
      code: 'TRANSCRIPTION_API_ERROR',
    });
  });

  it('logs how much was already transcribed when a chunk fails', async () => {
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({ text: 'a', truncated: false })
      .mockRejectedValueOnce(Object.assign(new Error('x'), {}));
    const d = deps({ transcribe });
    await expect(transcribeChunks(chunks, d)).rejects.toThrow('x');
    expect(d.log.warn).toHaveBeenCalledWith(
      'chunk failed, job aborted',
      expect.objectContaining({ index: 1, transcribed: 1, total: 3 }),
    );
  });

  it('retries a truncated chunk as two halves', async () => {
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({ text: 'cut', truncated: true })
      .mockResolvedValueOnce({ text: 'first', truncated: false })
      .mockResolvedValueOnce({ text: 'second', truncated: false });
    const extract = vi.fn(async () => audio);
    const d = deps({ transcribe, extract });
    await expect(transcribeChunks([chunks[0]], d)).resolves.toEqual(['first second']);
    expect(extract).toHaveBeenNthCalledWith(2, 0, 360);
    expect(extract).toHaveBeenNthCalledWith(3, 360, 720);
  });

  it('keeps a short truncated chunk as-is, logged', async () => {
    const d = deps({ transcribe: vi.fn(async () => ({ text: 'cut', truncated: true })) });
    await expect(transcribeChunks([{ index: 0, start: 0, end: 40 }], d)).resolves.toEqual(['cut']);
    expect(d.log.warn).toHaveBeenCalledWith('chunk transcript truncated', expect.anything());
  });
});
