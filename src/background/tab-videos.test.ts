import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedVideo } from '@/types';
import {
  createTabVideos,
  REPORT_WAIT_MS,
  SETTLE_MS,
  VERIFY_MS,
  type TabVideosDeps,
} from './tab-videos';

const vid = (externalId: string): DetectedVideo => ({
  id: `local-${externalId}`,
  provider: 'youtube',
  externalId,
  title: null,
  duration: null,
  iframeSrc: null,
  mediaSrc: null,
  isPlaying: false,
});

function setup(initial: Record<string, unknown> = {}, tabs = [1]) {
  const store: Record<string, unknown> = { ...initial };
  const deps = {
    session: {
      get: vi.fn(async () => ({ ...store })),
      set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(store, o)),
      remove: vi.fn(async (k: string | string[]) => {
        for (const key of [k].flat()) delete store[key];
      }),
    },
    liveTabIds: vi.fn(async () => tabs),
    sendToTab: vi.fn(async () => undefined),
  };
  return { store, deps, tv: createTabVideos(deps as unknown as TabVideosDeps) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createTabVideos', () => {
  it('mirrors published frames into session storage and restores them', async () => {
    const a = setup();
    a.tv.publish(1, 0, [vid('abc')]);
    expect(a.store['frames:1']).toEqual([[0, [vid('abc')]]]);

    const b = setup(a.store);
    await b.tv.ready;
    expect(b.tv.videosForTab(1).map((v) => v.externalId)).toEqual(['abc']);
  });

  it('drops persisted entries of tabs that no longer exist', async () => {
    const { store, deps, tv } = setup({ 'frames:9': [[0, [vid('x')]]] }, [1]);
    await tv.ready;
    expect(tv.videosForTab(9)).toEqual([]);
    expect(deps.session.remove).toHaveBeenCalledWith(['frames:9']);
    expect(store['frames:9']).toBeUndefined();
  });

  it('forget removes the tab from memory and session', async () => {
    const { store, tv } = setup();
    tv.publish(1, 0, [vid('abc')]);
    tv.forget(1);
    expect(tv.videosForTab(1)).toEqual([]);
    expect(store['frames:1']).toBeUndefined();
  });

  it('after a restart, answers from the mirror at once and asks the frames to report', async () => {
    const { deps, tv } = setup({ 'frames:1': [[0, [vid('old')]]] });
    const list = await tv.listForTab(1);
    expect(list.map((v) => v.externalId)).toEqual(['old']);
    expect(deps.sendToTab).toHaveBeenCalledWith(1, { type: 'REPORT_VIDEOS' });
    // The republish lands for the next list.
    tv.publish(1, 0, [vid('fresh')]);
    expect((await tv.listForTab(1)).map((v) => v.externalId)).toEqual(['fresh']);
    expect(deps.sendToTab).toHaveBeenCalledTimes(2); // + the restored entries' verification
  });

  it('after a restart, still waits for a tab the mirror knows nothing about', async () => {
    const { deps, tv } = setup();
    const pending = tv.listForTab(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.sendToTab).toHaveBeenCalledWith(1, { type: 'REPORT_VIDEOS' });
    tv.publish(1, 0, [vid('fresh')]);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect((await pending).map((v) => v.externalId)).toEqual(['fresh']);
  });

  it('gives up waiting on an unknown tab after REPORT_WAIT_MS', async () => {
    const { tv } = setup({}, [2]);
    let settled = false;
    const pending = tv.listForTab(2).then((list) => {
      settled = true;
      return list;
    });
    await vi.advanceTimersByTimeAsync(REPORT_WAIT_MS - 10);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toEqual([]);
  });

  it('asks a restored tab only once, even when nobody answers', async () => {
    const { deps, tv } = setup({ 'frames:1': [[0, [vid('old')]]] });
    expect((await tv.listForTab(1)).map((v) => v.externalId)).toEqual(['old']);
    expect((await tv.listForTab(1)).map((v) => v.externalId)).toEqual(['old']);
    expect(deps.sendToTab).toHaveBeenCalledTimes(1);
  });

  it('remembers a tab verified empty, so a restarted worker answers without waiting', async () => {
    const a = setup();
    await a.tv.verify(1); // nobody publishes: no video in the tab
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    expect(a.store['frames:1']).toEqual([]);
    const writes = a.deps.session.set.mock.calls.length;
    await a.tv.verify(1);
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    expect(a.deps.session.set.mock.calls.length).toBe(writes); // marker written once

    const b = setup(a.store);
    let settled = false;
    const pending = b.tv.listForTab(1).then((list) => {
      settled = true;
      return list;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(await pending).toEqual([]);
  });

  it('does not mark a tab without content script (nothing to spare there)', async () => {
    const { deps, store, tv } = setup();
    deps.sendToTab.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    expect(await tv.verify(1)).toBe(false);
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    expect(store['frames:1']).toBeUndefined();
    expect(deps.session.set).not.toHaveBeenCalled();
  });

  it('does not rewrite the mirror when a frame republishes the same list', () => {
    const { deps, tv } = setup();
    tv.publish(1, 0, [vid('abc')]);
    tv.publish(1, 0, [vid('abc')]);
    tv.publish(1, 3, []);
    expect(deps.session.set).toHaveBeenCalledTimes(1);
    tv.publish(1, 0, [vid('abc'), vid('def')]);
    expect(deps.session.set).toHaveBeenCalledTimes(2);
  });

  it('does not ask or wait for a tab that already published', async () => {
    const { deps, tv } = setup();
    tv.publish(1, 0, [vid('abc')]);
    expect((await tv.listForTab(1)).length).toBe(1);
    expect(deps.sendToTab).not.toHaveBeenCalled();
  });

  it('requestReport tells "no receiver" apart from delivered', async () => {
    const { deps, tv } = setup();
    deps.sendToTab.mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );
    expect(await tv.requestReport(1)).toBe(false);
    deps.sendToTab.mockRejectedValueOnce(new Error('The message port closed'));
    expect(await tv.requestReport(1)).toBe(true);
    expect(await tv.requestReport(1)).toBe(true);
  });

  it("never clears other frames on a single frame's publish (restored or live)", async () => {
    const { tv } = setup({ 'frames:1': [[4, [vid('sub')]]] });
    await tv.ready;
    tv.publish(1, 0, [vid('top')]);
    expect(tv.videosForTab(1).map((v) => v.externalId)).toEqual(['top', 'sub']);
    tv.publish(1, 7, [vid('ad')]);
    expect(tv.videosForTab(1).map((v) => v.externalId)).toEqual(['top', 'sub', 'ad']);
  });

  it('verify keeps the frames that republish and drops the silent ones', async () => {
    const { deps, tv } = setup();
    tv.publish(1, 0, [vid('top')]);
    tv.publish(1, 3, [vid('player')]);
    tv.publish(1, 9, [vid('gone')]);
    deps.sendToTab.mockImplementationOnce(async () => {
      // Same-document navigation: the live frames answer the report request.
      tv.publish(1, 0, [vid('top')]);
      tv.publish(1, 3, [vid('player')]);
    });
    expect(await tv.verify(1)).toBe(true);
    expect(tv.videosForTab(1)).toHaveLength(3); // nothing dropped before the sweep
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    expect(tv.videosForTab(1).map((v) => v.externalId)).toEqual(['top', 'player']);
  });

  it('verify drops everything when no content script is left in the tab', async () => {
    const { deps, store, tv } = setup();
    tv.publish(1, 0, [vid('top')]);
    deps.sendToTab.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    expect(await tv.verify(1)).toBe(false);
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    expect(tv.videosForTab(1)).toEqual([]);
    expect(store['frames:1']).toEqual([]);
  });

  it('a newer verify supersedes an older one', async () => {
    const { deps, tv } = setup();
    tv.publish(1, 2, [vid('player')]);
    await tv.verify(1);
    await vi.advanceTimersByTimeAsync(VERIFY_MS / 2);
    deps.sendToTab.mockImplementationOnce(async () => {
      tv.publish(1, 2, [vid('player')]);
      return undefined;
    });
    await tv.verify(1);
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    expect(tv.videosForTab(1)).toHaveLength(1);
  });

  it('ignores a late retraction from the previous document of a frame', () => {
    const { tv } = setup();
    tv.publish(1, 5, [vid('new')], 'doc-B');
    tv.publish(1, 5, [], 'doc-A'); // pagehide of the old document, delivered late
    expect(tv.videosForTab(1).map((v) => v.externalId)).toEqual(['new']);
    tv.publish(1, 5, [], 'doc-B');
    expect(tv.videosForTab(1)).toEqual([]);
  });

  it('verifies restored entries on the first live publish after a restart', async () => {
    const { deps, tv } = setup({ 'frames:1': [[4, [vid('stale')]]] });
    await tv.ready;
    tv.publish(1, 0, [vid('top')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.sendToTab).toHaveBeenCalledWith(1, { type: 'REPORT_VIDEOS' });
    tv.publish(1, 0, [vid('top')]); // the top frame answers; frame 4 is gone
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    expect(tv.videosForTab(1).map((v) => v.externalId)).toEqual(['top']);
  });

  it('publish reports whether it applied (false for a stale retraction)', () => {
    const { tv } = setup();
    expect(tv.publish(1, 3, [vid('new')], 'doc2')).toBe(true);
    expect(tv.publish(1, 3, [], 'doc1')).toBe(false);
    expect(tv.publish(1, 3, [], 'doc2')).toBe(true);
  });

  it("keeps each frame's own identity across a restart (placeholder replacement)", async () => {
    const placeholder: DetectedVideo = {
      ...vid('wistia:abc'),
      id: 'ph',
      provider: 'native',
      iframeSrc: 'https://fast.wistia.net/embed/iframe/abc',
    };
    const inside: DetectedVideo = {
      ...vid('wistia:abc'),
      id: 'in',
      provider: 'native',
      mediaSrc: 'https://embed.wistia.com/x.mp4',
    };
    const a = setup();
    a.tv.publish(1, 0, [placeholder]);
    a.tv.publish(1, 5, [inside], 'd5', 'wistia:abc');
    expect(a.tv.videosForTab(1).map((v) => v.id)).toEqual(['in']);
    expect(a.store['frames:1']).toEqual([
      [0, [placeholder]],
      [5, [inside], 'wistia:abc'],
    ]);
    const b = setup(a.store);
    await b.tv.ready;
    expect(b.tv.videosForTab(1).map((v) => v.id)).toEqual(['in']);
  });

  it('while a verification is in flight, the list waits for it (released early once all frames republish)', async () => {
    const { tv } = setup();
    tv.publish(1, 0, [vid('top')]);
    tv.publish(1, 4, [vid('sub')]);
    void tv.verify(1);
    let list: DetectedVideo[] | null = null;
    void tv.listForTab(1).then((l) => (list = l));
    await vi.advanceTimersByTimeAsync(10);
    expect(list).toBeNull();
    tv.publish(1, 0, [vid('top')]);
    await vi.advanceTimersByTimeAsync(10);
    expect(list).toBeNull(); // frame 4 not refreshed yet
    tv.publish(1, 4, [vid('sub')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(list!.map((v) => v.externalId)).toEqual(['top', 'sub']);
  });

  it('a list waiting on a verification gets the swept list, bounded by the sweep', async () => {
    const { tv } = setup();
    tv.publish(1, 0, [vid('top')]);
    tv.publish(1, 4, [vid('gone')]);
    void tv.verify(1);
    const pending = tv.listForTab(1);
    tv.publish(1, 0, [vid('top')]);
    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    expect((await pending).map((v) => v.externalId)).toEqual(['top']);
  });
});
