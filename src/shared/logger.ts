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
const GOOGLE_API_KEY = /AIza[0-9A-Za-z_-]{20,}/g;
const GROQ_API_KEY = /\bgsk_[A-Za-z0-9]{20,}/g;
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{20,}/g;
const GITHUB_PAT = /\bgithub_pat_[A-Za-z0-9_]{20,}/g;
const GITLAB_TOKEN = /\bglpat-[\w-]{10,}/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9-._~+/=]+/gi;
/** `Authorization: Basic xxx`, or a bare `Basic <long base64>` in free text. */
const BASIC_AUTH = /\bBasic\s+(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]{12,}={0,2}/g;
/** `Cookie: …` / `Set-Cookie: …` header lines in free text. */
const COOKIE_HEADER = /\b((?:set-)?cookie\s*:\s*)[^\n]+/gi;
/**
 * Secret-named query / fragment / matrix parameters: `api_key`, `apiKey`,
 * `access_token`, `refresh_token`, `*_secret`, `lsig`, `sig`, `auth`, `hmac`,
 * `signature`, bare `token`/`key`… The name must start after `?&;#`, a quote,
 * whitespace or the start of the string.
 */
const QUERY_SECRET =
  /(^|[?&;#\s"'])((?:[\w.-]*key|[\w.-]*(?:token|secret|signature|password|passwd|credential)[\w.-]*|sig|lsig|auth|hmac|authorization)=)[^&\s"';#]+/gi;
/** JSON text carried inside a string: `"apiKey":"…"`, `"cookie":"…"`. */
const JSON_SECRET =
  /("[^"\\]*(?:key|token|secret|authorization|cookie|password)[^"\\]*"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;
/** Same secrets in path form — googlevideo/Drive signed URLs also travel as
 * `/expire/<unix>/<…>/sig/<token>` or `…/signature/<token>` path segments. */
const PATH_SECRET = /\/(expire|signature|sig|lsig|ip|hmac)\/([^/?&\s"']+)/g;
/** Drive file ids are capabilities for link-shared files. */
const DRIVE_FILE_ID = /\/file\/d\/[^/?&\s"']+/g;
/** Akamai-style token segments: `exp=…~acl=…~hmac=…`. */
const AKAMAI_HMAC = /\bhmac=[^~&\s/"']+/gi;
const AKAMAI_ACL = /\bacl=[^~&\s"']+/gi;
const AKAMAI_EXP = /\bexp=\d+(?=~)/gi;
/** IPv4 addresses (not version strings like `Chrome/120.0.0.0`). */
const IPV4 =
  /(?<![\w.-])(?<![A-Za-z]\/)(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w]|\.\d)/g;
const KEY_FIELD = /key$/i;
const SECRET_FIELD = /(token|secret|password|passphrase|credential|cookie|signature|hmac)/i;
const SECRET_FIELD_EXACT = new Set(['authorization', 'sig', 'lsig', 'auth']);

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
      .replace(GROQ_API_KEY, REDACTED)
      .replace(GITHUB_TOKEN, REDACTED)
      .replace(GITHUB_PAT, REDACTED)
      .replace(GITLAB_TOKEN, REDACTED)
      .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
      .replace(BASIC_AUTH, `Basic ${REDACTED}`)
      .replace(COOKIE_HEADER, `$1${REDACTED}`)
      .replace(JSON_SECRET, `$1"${REDACTED}"`)
      .replace(QUERY_SECRET, `$1$2${REDACTED}`)
      .replace(AKAMAI_HMAC, `hmac=${REDACTED}`)
      .replace(AKAMAI_ACL, `acl=${REDACTED}`)
      .replace(AKAMAI_EXP, `exp=${REDACTED}`)
      .replace(PATH_SECRET, `/$1/${REDACTED}`)
      .replace(DRIVE_FILE_ID, `/file/d/${REDACTED}`)
      .replace(IPV4, REDACTED),
  );
}

function isSecretField(name: string): boolean {
  return (
    KEY_FIELD.test(name) || SECRET_FIELD_EXACT.has(name.toLowerCase()) || SECRET_FIELD.test(name)
  );
}

/** Nesting beyond this is cut — also bounds `cause` chains. */
const MAX_DEPTH = 8;
const TRUNCATED = '[Truncated]';

/** Redacted copy of an object's own enumerable fields. */
function redactFields(
  source: Record<string, unknown>,
  seen: Set<object>,
  depth: number,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(source)) {
    copy[name] = isSecretField(name) ? REDACTED : redactValue(field, seen, depth + 1);
  }
  return copy;
}

/**
 * `seen` holds the *ancestors* of the value being copied (added on the way
 * down, removed on the way back): only a true cycle prints `[Circular]`, a
 * node merely referenced twice is copied twice.
 */
function redactValue(value: unknown, seen: Set<object>, depth = 0): unknown {
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'symbol') return value.toString();
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return CIRCULAR;
  if (depth > MAX_DEPTH) return TRUNCATED;
  seen.add(value);
  try {
    if (value instanceof Error) {
      const { cause } = value as { cause?: unknown };
      return {
        name: redactString(value.name),
        message: redactString(value.message),
        stack: value.stack ? redactString(value.stack) : undefined,
        ...redactFields(value as unknown as Record<string, unknown>, seen, depth),
        ...(cause !== undefined ? { cause: redactValue(cause, seen, depth + 1) } : {}),
      };
    }
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);
    if (value instanceof Map) {
      const copy: Record<string, unknown> = {};
      for (const [k, v] of value) {
        const name = typeof k === 'string' ? k : String(redactValue(k, seen, depth + 1));
        copy[name] = isSecretField(name) ? REDACTED : redactValue(v, seen, depth + 1);
      }
      return copy;
    }
    if (value instanceof Set) return [...value].map((v) => redactValue(v, seen, depth + 1));
    if (Array.isArray(value)) return value.map((item) => redactValue(item, seen, depth + 1));
    return redactFields(value as Record<string, unknown>, seen, depth);
  } finally {
    seen.delete(value);
  }
}

/**
 * Deep, non-mutating, circular-tolerant copy of a log payload with every
 * secret masked: API keys and tokens (`sk-…`, `AIza…`, `gh…_…`,
 * `github_pat_…`, `glpat-…`), `Bearer` tokens, secret-bearing query
 * parameters and secret-named fields (`…Key`, `Authorization`, `token`,
 * `password`, …) become `[REDACTED]`. Errors are flattened to
 * `{name, message, stack, …own props, cause}`; Maps become plain objects and
 * Sets arrays.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, new Set());
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
  let data: unknown;
  try {
    data = redact(raw.data);
  } catch {
    data = OVERSIZED; // a throwing getter / proxy — keep the line, lose the payload
  }
  const entry: LogEntry = {
    t: raw.t,
    level: raw.level,
    source: raw.source,
    msg: redactString(raw.msg),
    data,
  };
  return fitEntry(entry);
}

/** Progressive shrink levels: [max array items, max string length, max depth]. */
const SHRINK_LEVELS: readonly [number, number, number][] = [
  [20, 500, 6],
  [8, 200, 4],
  [3, 80, 3],
];

/** Copy of redacted data with arrays, strings and depth cut to the given caps. */
function shrink(value: unknown, items: number, chars: number, depth: number): unknown {
  if (typeof value === 'string') {
    return value.length > chars
      ? `${value.slice(0, chars)}…[+${value.length - chars} chars]`
      : value;
  }
  if (value == null || typeof value !== 'object') return value;
  if (depth <= 0) return TRUNCATED;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    const kept = value.slice(0, items).map((v) => shrink(v, items, chars, depth - 1));
    return value.length > items ? [...kept, `…+${value.length - items} more`] : kept;
  }
  const copy: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(value)) {
    copy[name] = shrink(field, items, chars, depth - 1);
  }
  return copy;
}

/**
 * Keeps an entry under the per-line budget. Oversized `data` is shrunk
 * progressively (scalars kept, arrays and strings truncated) and only
 * replaced by a marker when nothing smaller fits.
 */
function fitEntry(entry: LogEntry): LogEntry {
  if (jsonSize(entry) <= MAX_ENTRY_JSON_LENGTH) return entry;
  for (const [items, chars, depth] of SHRINK_LEVELS) {
    const candidate = { ...entry, data: shrink(entry.data, items, chars, depth) };
    if (jsonSize(candidate) <= MAX_ENTRY_JSON_LENGTH) return candidate;
  }
  return { ...entry, data: OVERSIZED };
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
