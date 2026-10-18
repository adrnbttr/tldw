/**
 * Cheap, DOM-light helpers for the content script's observer. The script runs in
 * every frame of every page, so the work done per mutation must stay minimal.
 * Written against structural types (not DOM globals) so they unit-test in node.
 */

/** Click-to-load facades and JS-player placeholders (see detect.ts::facadeVideo). */
export const FACADE_SELECTOR =
  'lite-youtube[videoid],lite-vimeo[videoid],[data-youtube-id],[data-vimeo-id],' +
  '[data-plyr-embed-id],[data-video-id],[class*="wistia_async_"]';

/** YouTube thumbnails that may back a hand-made facade. */
export const THUMBNAIL_SELECTOR = 'img[src*="ytimg.com/vi"],img[src*="img.youtube.com/vi"]';

/** Selector for things whose appearance can change the detected list. */
export const INTERESTING_SELECTOR = `video,iframe,${FACADE_SELECTOR},${THUMBNAIL_SELECTOR}`;

/** Attributes whose change can change the detected list (MutationObserver filter). */
export const OBSERVED_ATTRIBUTES = [
  'src',
  'data-src',
  'data-lazy-src',
  'data-vimeo-id',
  'data-youtube-id',
  'videoid',
  'data-video-id',
  'data-plyr-embed-id',
];

interface NodeLike {
  nodeType: number;
  nodeName: string;
  localName?: string;
  shadowRoot?: unknown;
  querySelector?: (selector: string) => unknown;
  matches?: (selector: string) => boolean;
}

export interface MutationLike {
  type: string;
  target: NodeLike;
  attributeName?: string | null;
  addedNodes: ArrayLike<NodeLike>;
  removedNodes: ArrayLike<NodeLike>;
}

const ELEMENT_NODE = 1;
const MEDIA_ATTRS = new Set(OBSERVED_ATTRIBUTES);
/** Attributes that only matter on a media element (`src` is everywhere). */
const MEDIA_ONLY_ATTRS = new Set(['src', 'data-src', 'data-lazy-src']);

function isMediaElement(name: string): boolean {
  return name === 'VIDEO' || name === 'IFRAME';
}

/** A custom element (`*-*`) or any element hosting an open shadow root. */
function isShadowCandidate(node: NodeLike): boolean {
  return node.nodeType === ELEMENT_NODE && (!!node.localName?.includes('-') || !!node.shadowRoot);
}

/**
 * A node whose arrival or departure can change the light-DOM scan: a media
 * element, a shadow host, or a subtree holding a video/iframe/facade. A bare
 * custom element without a shadow root is NOT one: whatever player it may
 * grow lives in a shadow root the scan only reads once a discovery walk has
 * found it — and the walk is requested separately ({@link summarizeMutations}'
 * `shadowCandidate`), and publishes itself when it finds a root. Treating
 * every custom element as relevant re-scanned custom-element-heavy pages
 * (YouTube, Reddit) on every DOM change for nothing.
 */
function isInteresting(node: NodeLike): boolean {
  if (node.nodeType !== ELEMENT_NODE) return false;
  if (isMediaElement(node.nodeName)) return true;
  // A shadow host coming or going may carry a known root's player with it.
  if (node.shadowRoot) return true;
  if (node.matches?.(INTERESTING_SELECTOR)) return true;
  return !!node.querySelector?.(INTERESTING_SELECTOR);
}

function isRelevantAttribute(r: MutationLike): boolean {
  if (!r.attributeName || !MEDIA_ATTRS.has(r.attributeName)) return false;
  const name = r.target.nodeName;
  if (isMediaElement(name) || !MEDIA_ONLY_ATTRS.has(r.attributeName)) return true;
  // `src` on <source> feeds the parent <video>.
  return name === 'SOURCE' && r.attributeName === 'src';
}

export interface MutationSummary {
  /** The batch can change the detected list (see {@link isRelevantMutation}). */
  relevant: boolean;
  /** The batch adds a possible shadow host (see {@link addsShadowCandidate}). */
  shadowCandidate: boolean;
}

/**
 * Both verdicts on a batch in a single pass over the records — the observer
 * callback runs on every DOM change of every frame, and each record/node
 * property read crosses into the page's DOM. `wantShadow` false skips the
 * shadow-candidate search (the frame does not want discovery walks). Stops as
 * soon as nothing more can be learned.
 */
export function summarizeMutations(
  records: ArrayLike<MutationLike>,
  wantShadow = true,
): MutationSummary {
  let relevant = false;
  let shadowCandidate = !wantShadow;
  for (let i = 0; i < records.length && !(relevant && shadowCandidate); i++) {
    const r = records[i];
    if (r.type === 'attributes') {
      if (!relevant && isRelevantAttribute(r)) relevant = true;
      continue;
    }
    if (!relevant && r.target.nodeName === 'TITLE') relevant = true;
    const added = r.addedNodes;
    for (let j = 0; j < added.length && !(relevant && shadowCandidate); j++) {
      const node = added[j];
      if (!shadowCandidate && isShadowCandidate(node)) shadowCandidate = true;
      if (!relevant && isInteresting(node)) relevant = true;
    }
    if (relevant) continue;
    const removed = r.removedNodes;
    for (let j = 0; j < removed.length && !relevant; j++)
      if (isInteresting(removed[j])) relevant = true;
  }
  return { relevant, shadowCandidate: wantShadow && shadowCandidate };
}

/**
 * Whether a batch of mutation records can change what the page's videos look
 * like: a video/iframe/facade/shadow host (or a subtree containing one) was
 * added or removed, a media attribute changed, or the title changed.
 * Anything else — the vast majority of DOM churn — is ignored.
 */
export function isRelevantMutation(records: ArrayLike<MutationLike>): boolean {
  return summarizeMutations(records, false).relevant;
}

/**
 * Whether the records add an element that may host (or later attach) a shadow
 * root: a custom element or an element already hosting one. Such an element
 * calls for a fresh shadow walk — its root is invisible to the observer.
 */
export function addsShadowCandidate(records: ArrayLike<MutationLike>): boolean {
  for (let i = 0; i < records.length; i++) {
    const added = records[i].addedNodes;
    for (let j = 0; j < added.length; j++) if (isShadowCandidate(added[j])) return true;
  }
  return false;
}

/**
 * Trailing debounce with a max-wait: bursts are coalesced, but a page that
 * mutates continuously still publishes at least every `maxWaitMs`.
 */
export function createScheduler(
  fn: () => void,
  waitMs: number,
  maxWaitMs: number,
  timers: {
    setTimeout: (cb: () => void, ms: number) => unknown;
    /** Unused since the scheduler stopped re-arming per call; kept for callers. */
    clearTimeout?: (id: unknown) => void;
    now: () => number;
  } = {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    now: () => Date.now(),
  },
): () => void {
  let timer: unknown = null;
  let firstAt = 0;
  let lastAt = 0;
  // One timer per burst instead of a clear + re-arm per call (a page mutating
  // every few ms would otherwise churn timers nonstop): a call only records
  // its time, and the timer, when it fires early, re-arms for what is left.
  const fire = () => {
    const now = timers.now();
    const due = Math.min(lastAt + waitMs, firstAt + maxWaitMs);
    if (now < due) {
      timer = timers.setTimeout(fire, due - now);
      return;
    }
    timer = null;
    fn();
  };
  return () => {
    const now = timers.now();
    lastAt = now;
    if (timer != null) return;
    firstAt = now;
    timer = timers.setTimeout(fire, Math.min(waitMs, maxWaitMs));
  };
}

interface ShadowHostLike {
  shadowRoot?: ShadowRootLike | null;
}

export interface ShadowRootLike {
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

export interface ShadowScan {
  roots: ShadowRootLike[];
  /** Elements looked at (all of them: the shadow-root check is one property read). */
  visited: number;
  /** The walk stopped early (time or host budget): results are partial. */
  truncated: boolean;
}

export interface ShadowWalkOptions {
  /** Max nesting of shadow roots (a root inside a root inside … ). */
  maxDepth?: number;
  /** Max shadow hosts collected — the budget counts hosts, not plain elements. */
  maxHosts?: number;
  /** Wall-clock budget of one walk, in ms. */
  budgetMs?: number;
  now?: () => number;
}

/**
 * Collects the open shadow roots reachable from `root`, on ANY element (custom
 * elements, but also a plain `<div>` with `attachShadow`), nested up to
 * `maxDepth` levels. Every element is checked — a single property read — so a
 * player at the end of a large page is still found; the cost is bounded by a
 * wall-clock budget (checked every 256 elements) and a host budget.
 */
export function collectShadowRoots(
  root: ShadowRootLike,
  {
    maxDepth = 6,
    maxHosts = 500,
    budgetMs = 8,
    now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  }: ShadowWalkOptions = {},
): ShadowScan {
  const out: ShadowScan = { roots: [], visited: 0, truncated: false };
  const start = now();
  const walk = (scope: ShadowRootLike, depth: number): void => {
    const all = scope.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      if (out.truncated) return;
      if ((++out.visited & 255) === 0 && now() - start > budgetMs) {
        out.truncated = true;
        return;
      }
      const shadow = (all[i] as ShadowHostLike).shadowRoot;
      if (!shadow) continue;
      if (out.roots.length >= maxHosts) {
        out.truncated = true;
        return;
      }
      out.roots.push(shadow);
      if (depth + 1 < maxDepth) walk(shadow, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}
