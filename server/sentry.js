/**
 * Error reporting for the realtime service (s84).
 *
 * Until s84 this process reported nothing: a crash was a log line and
 * `process.exit(1)`, visible only to someone already reading `fly logs`. On the
 * one realtime machine (ADR 026) a crash loop presents to editors as "live
 * updates stopped", with nothing anywhere saying why.
 *
 * WHAT IS CAPTURED, AND HOW
 * -------------------------
 * The two fatal paths — an uncaught exception and an unhandled rejection —
 * through the crash handlers `index.js` already had: capture, flush for at most
 * FLUSH_TIMEOUT_MS, then the same `exit(1)` as before. Sentry's own global
 * handlers are removed (`OWN_GLOBAL_HANDLERS`): ours exit synchronously, so
 * theirs would either never run or never flush, and `OnUnhandledRejection`
 * prints a warning of its own — a behaviour change this file is not allowed to
 * make. No tracing, no `sendDefaultPii`.
 *
 * Off unless SENTRY_DSN is set, and only that variable: not
 * NEXT_PUBLIC_SENTRY_DSN, because in development this process loads the repo
 * root's `.env.local`, which carries the app's DSN — every local crash would
 * land in production's project. And "unset" means `init` is never called:
 * `@sentry/node` falls back to `process.env.SENTRY_DSN` on its own when handed
 * `dsn: undefined`.
 *
 * WHAT IS SCRUBBED
 * ----------------
 * This service handles credentials in URLs. The socket.io handshake carries
 * `token` (the site's HMAC token), `stagingToken` and `editToken` in its query
 * string; a Redis or Supabase error can carry a connection URL with its
 * password; a Supabase key is a JWT. Every string in the event — messages,
 * exception values, source context lines, breadcrumbs — has sensitive query
 * parameters, `key: value` / `"key":"value"` pairs, URL userinfo, bearer
 * values and JWTs replaced with FILTERED. Every object, at EVERY depth, has the
 * values of sensitive keys filtered and client IP headers dropped (personal
 * data). Every function here returns a new object; the SDK's event is never
 * mutated.
 *
 * Every depth, not just the top of headers and breadcrumb data: the s84 review
 * planted six tokens — in a console breadcrumb's `data.arguments` (the logged
 * object itself), under `extra.handshake.auth`, `contexts.socket.query`, and as
 * a JSON or `util.inspect` string — and the first version let all six through.
 * The console integration attaches recent log lines to every crash event, so
 * one `console.log(socket.handshake)` anywhere would have shipped them.
 *
 * `@sentry/node` itself is loaded by `initSentry`, not at the top of this
 * file: required eagerly it cost ~37 MB of RSS and ~0.5 s of boot on the one
 * 512 MB machine even with reporting off (s84 review, F6).
 */

/** The SDK, once `initSentry` has loaded it; null while reporting is off. */
let sentry = null;

const FILTERED = '[Filtered]';

/** Bounded wait for the event to leave before the process exits. */
const FLUSH_TIMEOUT_MS = 2000;

/** How deep the scrubber walks. Sentry events are normalised well above this. */
const MAX_SCRUB_DEPTH = 12;

/**
 * Names whose value is a credential, in a query string, header, object key or
 * `key: value` text: any name CONTAINING one of the first list, or exactly one
 * of the second. `handoff` and `grant` are this product's own: an edit link
 * arrives as `?rcf_staging=1&rcf_token=…` or `?rcf_edit_token=…`, and the
 * editor hub redirects with `?rcf_handoff=<code>` — a one-time credential with
 * no "token" in its name (public/embed/recopyfast.src.js).
 */
const SENSITIVE_NAME_PARTS = [
  'token',
  'secret',
  'passw',
  'auth',
  'cookie',
  'session',
  'signature',
  'credential',
  'handoff',
  'grant',
  'api[-_]?key',
  'apikey',
  'jwt',
  'bearer',
];
const SENSITIVE_EXACT_NAMES = ['key', 'sig', 'code'];

const SENSITIVE_NAME = new RegExp(
  `${SENSITIVE_NAME_PARTS.join('|')}|${SENSITIVE_EXACT_NAMES.map((name) => `^${name}$`).join('|')}`,
  'i'
);

/** Headers that carry the client's address. */
const IP_HEADERS = new Set([
  'x-forwarded-for',
  'x-real-ip',
  'fly-client-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'forwarded',
]);

/** Sentry's integrations whose job our crash handlers already do. */
const OWN_GLOBAL_HANDLERS = new Set(['OnUncaughtException', 'OnUnhandledRejection']);

/** `name=value` after `?`, `&`, `;`, whitespace or the start of the string. */
const QUERY_PAIR = /(^|[?&;\s])([^=&?#\s"'<>]+)=([^&#\s"'<>]*)/g;

/** Characters that may sit inside a key in `key: value` text. */
const KEY_CHAR = '[\\w$.-]';
/**
 * A SENSITIVE key in text, then `:` (spaces allowed) or `=`, then its value:
 * quoted (JSON's `"stagingToken":"…"`, `util.inspect`'s `token: '…'`) or bare
 * up to a delimiter — with a leading auth scheme taken along, so
 * `Authorization: Basic …` loses the credential and not just the word "Basic".
 * Only sensitive keys are matched, so an innocent key's value never swallows a
 * sensitive pair behind it (`info:token=…`). Spaced `=` is left alone: that is
 * a source context line (`const token = …`), not a logged value.
 */
const SENSITIVE_KEY_VALUE = new RegExp(
  `(["']?)((?<!${KEY_CHAR})(?:${KEY_CHAR}*(?:${SENSITIVE_NAME_PARTS.join('|')})${KEY_CHAR}*|${SENSITIVE_EXACT_NAMES.join('|')})(?!${KEY_CHAR}))\\1(\\s*:\\s*|=)` +
    `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|(?:(?:Bearer|Basic|Digest)\\s+)?[^\\s,;{}[\\]"'&]+)`,
  'gi'
);
/** `scheme://user:password@` — Redis and Postgres URLs in error messages. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function isSensitiveName(name) {
  return SENSITIVE_NAME.test(name);
}

function isSensitiveKey(key) {
  return isSensitiveName(key) || IP_HEADERS.has(key.toLowerCase());
}

/** A filtered value that keeps the quotes it had, so JSON stays JSON. */
function filteredLike(value) {
  const quote = value[0];
  return quote === '"' || quote === "'" ? `${quote}${FILTERED}${quote}` : FILTERED;
}

function scrubString(value) {
  return value
    .replace(URL_USERINFO, `$1${FILTERED}@`)
    .replace(
      SENSITIVE_KEY_VALUE,
      (_match, quote, key, separator, secret) =>
        `${quote}${key}${quote}${separator}${filteredLike(secret)}`
    )
    // An empty value hides nothing — and is what a quoted value the line above
    // already filtered (`handoff="[Filtered]"`) looks like from here.
    .replace(QUERY_PAIR, (match, separator, name, value) =>
      value && isSensitiveName(name) ? `${separator}${name}=${FILTERED}` : match
    )
    .replace(BEARER, `$1 ${FILTERED}`)
    .replace(JWT, FILTERED);
}

/**
 * Every string through `scrubString`, and every sensitive key's value
 * replaced, at any depth. Past MAX_SCRUB_DEPTH an object is dropped rather than
 * passed through unread.
 */
function scrubDeep(value, depth = 0) {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_SCRUB_DEPTH) return FILTERED;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? FILTERED : scrubDeep(item, depth + 1),
    ])
  );
}

function scrubQueryString(queryString) {
  if (Array.isArray(queryString)) {
    return queryString.map((pair) =>
      Array.isArray(pair) && typeof pair[0] === 'string' && isSensitiveName(pair[0])
        ? [pair[0], FILTERED]
        : scrubDeep(pair)
    );
  }
  return scrubDeep(queryString);
}

function scrubRequest(request) {
  // Cookies are dropped outright: there is no cookie here worth reading.
  const { cookies: _cookies, query_string: queryString, ...rest } = request;
  return {
    ...scrubDeep(rest),
    ...(queryString === undefined ? {} : { query_string: scrubQueryString(queryString) }),
  };
}

function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== 'object') return breadcrumb;
  return scrubDeep(breadcrumb);
}

function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;
  // `modules` is `modulesIntegration`'s package-name → version map, read from
  // package.json files, never from a request: kept whole, or the key filter
  // would blank `jsonwebtoken`'s or `cookie`'s version.
  const { request, breadcrumbs, user, modules, ...rest } = event;
  const { ip_address: _ipAddress, ...userWithoutIp } = user || {};
  return {
    ...scrubDeep(rest),
    ...(modules === undefined ? {} : { modules }),
    ...(request === undefined ? {} : { request: scrubRequest(request) }),
    ...(breadcrumbs === undefined
      ? {}
      : { breadcrumbs: breadcrumbs.map((breadcrumb) => scrubBreadcrumb(breadcrumb)) }),
    ...(user === undefined ? {} : { user: scrubDeep(userWithoutIp) }),
  };
}

/**
 * Start reporting, or do nothing. Returns whether Sentry is now on.
 * Called once, from the CLI path, after the environment is loaded.
 */
function initSentry(env = process.env) {
  // SENTRY_DSN and nothing else — never NEXT_PUBLIC_SENTRY_DSN (see the top of
  // this file). Pinned in src/__tests__/websocket/sentry.test.ts.
  const dsn = env.SENTRY_DSN;
  if (!dsn) return false;

  sentry = require('@sentry/node');
  sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
    sendDefaultPii: false,
    integrations: (defaults) =>
      defaults.filter((integration) => !OWN_GLOBAL_HANDLERS.has(integration.name)),
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    initialScope: { tags: { service: 'realtime' } },
  });
  return true;
}

/**
 * The crash handlers' last act. Without Sentry: `exit(1)` now, exactly as
 * before s84. With it: capture, wait for the send (bounded), then `exit(1)`.
 * The exit happens whatever the flush does — a reporting failure must never
 * keep a crashed process alive.
 */
function reportFatalAndExit(error, exit = (code) => process.exit(code)) {
  if (!sentry || !sentry.isInitialized()) {
    exit(1);
    return;
  }

  try {
    sentry.captureException(error, { level: 'fatal' });
  } catch {
    // Reporting is best effort; the exit below is not.
  }

  sentry
    .flush(FLUSH_TIMEOUT_MS)
    .catch(() => false)
    .finally(() => exit(1));
}

module.exports = {
  FILTERED,
  initSentry,
  reportFatalAndExit,
  scrubBreadcrumb,
  scrubEvent,
};
