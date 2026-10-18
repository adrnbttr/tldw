import { describe, expect, it, vi } from 'vitest';
import {
  addsShadowCandidate,
  collectShadowRoots,
  createScheduler,
  isRelevantMutation,
  summarizeMutations,
} from './observe';
import type { MutationLike } from './observe';

const el = (nodeName: string, extra: Record<string, unknown> = {}) => ({
  nodeType: 1,
  nodeName,
  localName: nodeName.toLowerCase(),
  ...extra,
});
const rec = (r: Partial<MutationLike>): MutationLike => ({
  type: 'childList',
  target: el('DIV'),
  addedNodes: [],
  removedNodes: [],
  ...r,
});

describe('isRelevantMutation', () => {
  it('ignores plain DOM churn', () => {
    expect(
      isRelevantMutation([
        rec({ addedNodes: [el('DIV'), { nodeType: 3, nodeName: '#text' }] }),
        rec({ type: 'attributes', attributeName: 'class', target: el('DIV') }),
      ]),
    ).toBe(false);
  });

  it('flags added/removed video, iframe, shadow hosts and subtrees holding one', () => {
    expect(isRelevantMutation([rec({ addedNodes: [el('VIDEO')] })])).toBe(true);
    expect(isRelevantMutation([rec({ removedNodes: [el('IFRAME')] })])).toBe(true);
    expect(isRelevantMutation([rec({ removedNodes: [el('X-PLAYER', { shadowRoot: {} })] })])).toBe(
      true,
    );
    expect(
      isRelevantMutation([rec({ addedNodes: [el('X-CARD', { querySelector: () => ({}) })] })]),
    ).toBe(true);
    expect(
      isRelevantMutation([rec({ addedNodes: [el('DIV', { querySelector: () => ({}) })] })]),
    ).toBe(true);
    expect(
      isRelevantMutation([rec({ addedNodes: [el('DIV', { querySelector: () => null })] })]),
    ).toBe(false);
  });

  it('flags src changes on media elements only, and title changes', () => {
    const attr = (name: string, attributeName: string) =>
      rec({ type: 'attributes', attributeName, target: el(name) });
    expect(isRelevantMutation([attr('VIDEO', 'src')])).toBe(true);
    expect(isRelevantMutation([attr('IFRAME', 'src')])).toBe(true);
    expect(isRelevantMutation([attr('IMG', 'src')])).toBe(false);
    expect(isRelevantMutation([rec({ target: el('TITLE') })])).toBe(true);
  });
});

describe('createScheduler', () => {
  it('debounces bursts but fires within maxWait on a page that never settles', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const schedule = createScheduler(fn, 400, 2000, {
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
    });
    for (let t = 0; t < 2100; t += 200) {
      schedule();
      vi.advanceTimersByTime(200);
    }
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(2); // burst ended: one trailing call
    vi.useRealTimers();
  });

  it('fires waitMs after the last call of a burst, with one timer per burst', () => {
    let now = 0;
    const pending: Array<{ at: number; cb: () => void }> = [];
    const fn = vi.fn();
    const schedule = createScheduler(fn, 400, 2000, {
      setTimeout: (cb, ms) => pending.push({ at: now + ms, cb }),
      now: () => now,
    });
    const advance = (to: number) => {
      for (;;) {
        pending.sort((a, b) => a.at - b.at);
        const next = pending[0];
        if (!next || next.at > to) break;
        pending.shift();
        now = next.at;
        next.cb();
      }
      now = to;
    };
    for (let t = 0; t <= 300; t += 10) {
      advance(t);
      schedule();
    }
    // 31 calls, a single armed timer (re-armed once when it fired early).
    expect(pending).toHaveLength(1);
    advance(699);
    expect(fn).not.toHaveBeenCalled();
    advance(700);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(0);
  });
});

describe('isRelevantMutation — facades and lazy iframes', () => {
  it('flags facade / lazy-src attribute changes and added facades', () => {
    const attr = (name: string, attributeName: string) =>
      rec({ type: 'attributes', attributeName, target: el(name) });
    expect(isRelevantMutation([attr('IFRAME', 'data-src')])).toBe(true);
    expect(isRelevantMutation([attr('LITE-YOUTUBE', 'videoid')])).toBe(true);
    expect(isRelevantMutation([attr('DIV', 'data-plyr-embed-id')])).toBe(true);
    expect(isRelevantMutation([attr('DIV', 'data-src')])).toBe(false);
    expect(isRelevantMutation([rec({ addedNodes: [el('DIV', { matches: () => true })] })])).toBe(
      true,
    );
  });

  it('flags an added plain element hosting a shadow root', () => {
    expect(isRelevantMutation([rec({ addedNodes: [el('DIV', { shadowRoot: {} })] })])).toBe(true);
  });
});

describe('isRelevantMutation — bare custom elements', () => {
  it('ignores a custom element without shadow root nor media inside (the walk handles it)', () => {
    expect(isRelevantMutation([rec({ addedNodes: [el('MUX-PLAYER')] })])).toBe(false);
    expect(
      isRelevantMutation([
        rec({
          addedNodes: [el('YT-CARD', { matches: () => false, querySelector: () => null })],
          removedNodes: [el('YT-CARD', { matches: () => false, querySelector: () => null })],
        }),
      ]),
    ).toBe(false);
  });
});

describe('summarizeMutations', () => {
  it('answers both questions in one pass', () => {
    expect(summarizeMutations([rec({ addedNodes: [el('X-PLAYER')] })])).toEqual({
      relevant: false,
      shadowCandidate: true,
    });
    expect(summarizeMutations([rec({ addedNodes: [el('VIDEO')] })])).toEqual({
      relevant: true,
      shadowCandidate: false,
    });
    expect(
      summarizeMutations([
        rec({ addedNodes: [el('X-PLAYER')] }),
        rec({ removedNodes: [el('IFRAME')] }),
      ]),
    ).toEqual({ relevant: true, shadowCandidate: true });
  });

  it('skips the shadow-candidate search when not wanted', () => {
    expect(summarizeMutations([rec({ addedNodes: [el('X-PLAYER')] })], false)).toEqual({
      relevant: false,
      shadowCandidate: false,
    });
  });

  it('stops reading records once both answers are known', () => {
    let reads = 0;
    const counted = (r: MutationLike): MutationLike =>
      new Proxy(r, {
        get(target, key) {
          if (key === 'type') reads++;
          return target[key as keyof MutationLike];
        },
      });
    summarizeMutations([
      counted(rec({ addedNodes: [el('X-PLAYER'), el('VIDEO')] })),
      counted(rec({ addedNodes: [el('DIV')] })),
    ]);
    expect(reads).toBe(1);
  });
});

describe('addsShadowCandidate', () => {
  it('is true for added custom elements or shadow hosts only', () => {
    expect(addsShadowCandidate([rec({ addedNodes: [el('X-PLAYER')] })])).toBe(true);
    expect(addsShadowCandidate([rec({ addedNodes: [el('DIV', { shadowRoot: {} })] })])).toBe(true);
    expect(addsShadowCandidate([rec({ addedNodes: [el('DIV')] })])).toBe(false);
    expect(addsShadowCandidate([rec({ removedNodes: [el('X-PLAYER')] })])).toBe(false);
  });
});

describe('collectShadowRoots', () => {
  const root = (children: unknown[]) => ({ querySelectorAll: () => children });

  it('finds nested open roots on any element, up to 6 levels deep', () => {
    // div > shadow > a-b > shadow > … 7 levels.
    let inner = root([]);
    const chain = [inner];
    for (let i = 0; i < 7; i++) {
      inner = root([{ shadowRoot: inner }]);
      chain.push(inner);
    }
    const res = collectShadowRoots(root([{ localName: 'div', shadowRoot: inner }]));
    expect(res.roots).toHaveLength(6);
    expect(res.roots[0]).toBe(inner);
  });

  it('finds a host at the end of a large page (budget counts hosts, not elements)', () => {
    const plain = Array.from({ length: 3000 }, () => ({ shadowRoot: null }));
    const target = root([]);
    const res = collectShadowRoots(root([...plain, { shadowRoot: target }]));
    expect(res.roots).toEqual([target]);
    expect(res.truncated).toBe(false);
  });

  it('stops after the host budget or the time budget', () => {
    const many = Array.from({ length: 50 }, () => ({ shadowRoot: root([]) }));
    const byHosts = collectShadowRoots(root(many), { maxHosts: 10 });
    expect(byHosts.roots).toHaveLength(10);
    expect(byHosts.truncated).toBe(true);

    let t = 0;
    const plain = Array.from({ length: 5000 }, () => ({ shadowRoot: null }));
    const byTime = collectShadowRoots(root(plain), { budgetMs: 8, now: () => (t += 5) });
    expect(byTime.truncated).toBe(true);
    expect(byTime.visited).toBeLessThan(5000);
  });
});
