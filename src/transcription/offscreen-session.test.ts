import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSerialQueue } from './offscreen-session';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createSerialQueue', () => {
  it('runs tasks one at a time, in order, and reports waiting ones', async () => {
    const queue = createSerialQueue();
    const order: string[] = [];
    const gate = deferred();
    const onQueued = vi.fn();

    const a = queue.run(async () => {
      order.push('a:start');
      await gate.promise;
      order.push('a:end');
    });
    const b = queue.run(
      async () => {
        order.push('b');
      },
      { onQueued },
    );

    expect(onQueued).toHaveBeenCalledOnce();
    expect(queue.size).toBe(2);
    await Promise.resolve();
    expect(order).toEqual(['a:start']);
    gate.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b']);
    expect(queue.size).toBe(0);
  });

  it('tells a waiting task how many are ahead, again each time the line moves', async () => {
    const queue = createSerialQueue();
    const g1 = deferred();
    const g2 = deferred();
    const a = queue.run(() => g1.promise);
    const b = queue.run(() => g2.promise);
    const onQueued = vi.fn();
    const c = queue.run(async () => {}, { onQueued });
    expect(onQueued.mock.calls).toEqual([[2]]);
    g1.resolve();
    await a;
    await vi.waitFor(() => expect(onQueued.mock.calls).toEqual([[2], [1]]));
    g2.resolve();
    await Promise.all([b, c]);
    expect(onQueued).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a failed task', async () => {
    const queue = createSerialQueue();
    const a = queue.run(async () => {
      throw new Error('boom');
    });
    const b = queue.run(async () => 'ok');
    await expect(a).rejects.toThrow('boom');
    await expect(b).resolves.toBe('ok');
  });

  it('a task cancelled while waiting rejects without running and frees its place', async () => {
    const queue = createSerialQueue();
    const gate = deferred();
    const a = queue.run(() => gate.promise);
    const controller = new AbortController();
    const task = vi.fn(async () => {});
    const b = queue.run(task, { signal: controller.signal });
    controller.abort();
    await expect(b).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(task).not.toHaveBeenCalled();
    expect(queue.size).toBe(1);
    gate.resolve();
    await a;
    await expect(queue.run(async () => 1)).resolves.toBe(1);
  });
});

describe('ensureOffscreen', () => {
  function stubOffscreen(createDocument: () => Promise<void>) {
    let open = false;
    const api = {
      hasDocument: vi.fn(async () => open),
      createDocument: vi.fn(async () => {
        await createDocument();
        open = true;
      }),
      closeDocument: vi.fn(async () => {
        open = false;
      }),
      Reason: { WORKERS: 'WORKERS' },
    };
    vi.stubGlobal('chrome', { offscreen: api });
    return api;
  }

  it('shares one creation between concurrent callers', async () => {
    const api = stubOffscreen(async () => {});
    const { ensureOffscreen } = await import('./offscreen-session');
    await Promise.all([ensureOffscreen(), ensureOffscreen(), ensureOffscreen()]);
    expect(api.createDocument).toHaveBeenCalledOnce();
  });

  it('tolerates the "single offscreen document" race', async () => {
    stubOffscreen(async () => {
      throw new Error('Only a single offscreen document may be created.');
    });
    const { ensureOffscreen } = await import('./offscreen-session');
    await expect(ensureOffscreen()).resolves.toBeUndefined();
  });

  it('types any other creation failure', async () => {
    stubOffscreen(async () => {
      throw new Error('nope');
    });
    const { ensureOffscreen } = await import('./offscreen-session');
    await expect(ensureOffscreen()).rejects.toMatchObject({ code: 'AUDIO_EXTRACTION_FAILED' });
  });

  it('closes an orphan document on worker startup', async () => {
    const api = stubOffscreen(async () => {});
    api.hasDocument.mockResolvedValueOnce(true);
    const { reconcileOrphanOffscreen } = await import('./offscreen-session');
    await reconcileOrphanOffscreen();
    expect(api.closeDocument).toHaveBeenCalledOnce();
  });
});
