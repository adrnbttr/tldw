/**
 * Logging primitives shared by every context (sw, offscreen, content, popup):
 * secret redaction, a bounded in-memory buffer and sink-injected loggers.
 * Pure — no `chrome` or DOM access, mirroring the job store's DI style.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'sw' | 'offscreen' | 'content' | 'popup';

/** One line of log, as kept by the buffer and shipped to the sink. */
export interface LogEntry {
  t: number;
  level: LogLevel;
  source: LogSource;
  msg: string;
  data?: unknown;
}

/** Where finished entries go; a throwing sink is swallowed by the logger. */
export type LogSink = (entry: LogEntry) => void;

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export const DEFAULT_LOG_CAPACITY = 500;

const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';
const OVERSIZED = '[dropped: oversized]';
const MAX_STRING_LENGTH = 2048;
const MAX_ENTRY_JSON_LENGTH = 8000;

const SK_API_KEY = /\bsk-[A-Za-z0-9_-]{3,}/g;
const GOOGLE_API_KEY = /AIza[0-9A-Za-z_-]{35}/g;
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{20,}/g;
const GITHUB_PAT = /\bgithub_pat_[A-Za-z0-9_]{20,}/g;
const GITLAB_TOKEN = /\bglpat-[\w-]{10,}/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9-._~+/=]+/gi;
const QUERY_SECRET =
  /(\b(?:access_token|client_secret|x-goog-signature|signature|token|sig|key)=)[^&\s"']+/gi;
/** Same secrets in path form — googlevideo/Drive signed URLs also travel as
 * `/expire/<unix>/<…>/sig/<token>` or `…/signature/<token>` path segments. */
const PATH_SECRET = /\/(expire|signature|sig)\/([^/?&\s"']+)/g;
const KEY_FIELD = /key$/i;
const SECRET_FIELD = /(token|secret|password|passphrase|credential)/i;

const LOG_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);
const LOG_SOURCES = new Set<string>(['sw', 'offscreen', 'content', 'popup']);

/** How far a wired entry's clock may legitimately skew: one hour, either way. */
const MAX_ENTRY_SKEW_MS = 60 * 60 * 1000;

/** Caps runaway strings, reporting how many characters were cut. */
function truncate(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  const cut = value.length - MAX_STRING_LENGTH;
  return `${value.slice(0, MAX_STRING_LENGTH)}…[+${cut} chars]`;
}

export function redactString(value: string): string {
  return truncate(
    value
      .replace(SK_API_KEY, REDACTED)
      .replace(GOOGLE_API_KEY, REDACTED)
      .replace(GITHUB_TOKEN, REDACTED)
      .replace(GITHUB_PAT, REDACTED)
      .replace(GITLAB_TOKEN, REDACTED)
      .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
      .replace(QUERY_SECRET, `$1${REDACTED}`)
      .replace(PATH_SECRET, `/$1/${REDACTED}`),
  );
}

function isSecretField(name: string): boolean {
  return KEY_FIELD.test(name) || name.toLowerCase() === 'authorization' || SECRET_FIELD.test(name);
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return CIRCULAR;
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: redactString(value.name),
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    for (const [k, v] of value) copy.set(redactValue(k, seen), redactValue(v, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>();
    for (const v of value) copy.add(redactValue(v, seen));
    return copy;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));

  const copy: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(value)) {
    copy[name] = isSecretField(name) ? REDACTED : redactValue(field, seen);
  }
  return copy;
}

/**
 * Deep, non-mutating, circular-tolerant copy of a log payload with every
 * secret masked: API keys and tokens (`sk-…`, `AIza…`, `gh…_…`,
 * `github_pat_…`, `glpat-…`), `Bearer` tokens, secret-bearing query
 * parameters and secret-named fields (`…Key`, `Authorization`, `token`,
 * `password`, …) become `[REDACTED]`. Errors are flattened to
 * `{name, message, stack}`.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}

/** Pure bounded append: new array out, oldest entries evicted past `max`. */
export function pushBounded(
  entries: readonly LogEntry[],
  entry: LogEntry,
  max: number = DEFAULT_LOG_CAPACITY,
): LogEntry[] {
  const next = [...entries, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Type guard for entries coming back from untrusted places: wire or storage. */
export function isLogEntry(value: unknown): value is LogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { t, level, source, msg } = value as Record<string, unknown>;
  return (
    typeof t === 'number' &&
    typeof msg === 'string' &&
    typeof level === 'string' &&
    LOG_LEVELS.has(level) &&
    typeof source === 'string' &&
    LOG_SOURCES.has(source)
  );
}

/** Serialized length; data that can't be serialized counts as oversized. */
function jsonSize(entry: LogEntry): number {
  try {
    return JSON.stringify(entry).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** True for a finite timestamp within ±1 h of now. */
function isPlausibleTime(t: number): boolean {
  return Number.isFinite(t) && Math.abs(Date.now() - t) <= MAX_ENTRY_SKEW_MS;
}

/**
 * Validates and normalizes an untrusted `LOG` payload before it enters the
 * buffer: malformed entries are rejected, along with any entry whose `t`
 * strays more than an hour from now (or isn't finite) — a forged or stale
 * clock must not corrupt the buffer's chronology. `msg` and `data` are
 * re-redacted (never trust the sender's own redaction) and an oversized
 * `data` is dropped so a single line can't blow the storage budget.
 */
export function sanitizeEntry(raw: unknown): LogEntry | null {
  if (!isLogEntry(raw)) return null;
  if (!isPlausibleTime(raw.t)) return null;
  const entry: LogEntry = {
    t: raw.t,
    level: raw.level,
    source: raw.source,
    msg: redactString(raw.msg),
    data: redact(raw.data),
  };
  return jsonSize(entry) > MAX_ENTRY_JSON_LENGTH ? { ...entry, data: OVERSIZED } : entry;
}

/** Builds entries with redacted `msg` and `data`, stamped with `source`, and ships them to the sink. */
export function createLogger(source: LogSource, sink: LogSink): Logger {
  const emit = (level: LogLevel, msg: string, data?: unknown): void => {
    try {
      sink({ t: Date.now(), level, source, msg: redactString(msg), data: redact(data) });
    } catch {
      // A broken sink is the logger's problem, never the caller's.
    }
  };

  return {
    debug: (msg, data) => emit('debug', msg, data),
    info: (msg, data) => emit('info', msg, data),
    warn: (msg, data) => emit('warn', msg, data),
    error: (msg, data) => emit('error', msg, data),
  };
}
