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
 * parameters, URL userinfo, bearer values and JWTs replaced with FILTERED.
 * Headers, request bodies, breadcrumb data and parsed query strings are also
 * filtered by key, and client IP headers are dropped (personal data).
 * Every function here returns a new object; the SDK's event is never mutated.
 */

const Sentry = require('@sentry/node');

const FILTERED = '[Filtered]';

/** Bounded wait for the event to leave before the process exits. */
const FLUSH_TIMEOUT_MS = 2000;

/** How deep the scrubber walks. Sentry events are normalised well above this. */
const MAX_SCRUB_DEPTH = 12;

/**
 * Names whose value is a credential, in a query string, header or object key.
 * `handoff` and `grant` are this product's own: an edit link arrives as
 * `?rcf_staging=1&rcf_token=…` or `?rcf_edit_token=…`, and the editor hub
 * redirects with `?rcf_handoff=<code>` — a one-time credential with no "token"
 * in its name (public/embed/recopyfast.src.js).
 */
const SENSITIVE_NAME =
  /token|secret|passw|auth|cookie|session|signature|credential|handoff|grant|api[-_]?key|apikey|jwt|bearer|^key$|^sig$|^code$/i;

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
/** `scheme://user:password@` — Redis and Postgres URLs in error messages. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function isSensitiveName(name) {
  return SENSITIVE_NAME.test(name);
}

function scrubString(value) {
  return value
    .replace(URL_USERINFO, `$1${FILTERED}@`)
    .replace(QUERY_PAIR, (match, separator, name) =>
      isSensitiveName(name) ? `${separator}${name}=${FILTERED}` : match
    )
    .replace(BEARER, `$1 ${FILTERED}`)
    .replace(JWT, FILTERED);
}

/** Every string, at any depth, through `scrubString`. Keys are kept. */
function scrubDeep(value, depth = 0) {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object' || depth > MAX_SCRUB_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, scrubDeep(item, depth + 1)])
  );
}

/** An object whose KEYS may name a credential: headers, bodies, parsed queries. */
function scrubByKey(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return scrubDeep(value);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveName(key) || IP_HEADERS.has(key.toLowerCase()) ? FILTERED : scrubDeep(item),
    ])
  );
}

function scrubQueryString(queryString) {
  if (typeof queryString === 'string') return scrubString(queryString);
  if (Array.isArray(queryString)) {
    return queryString.map((pair) =>
      Array.isArray(pair) && typeof pair[0] === 'string' && isSensitiveName(pair[0])
        ? [pair[0], FILTERED]
        : scrubDeep(pair)
    );
  }
  return scrubByKey(queryString);
}

function scrubRequest(request) {
  // Cookies are dropped outright: there is no cookie here worth reading.
  const { cookies: _cookies, headers, data, query_string: queryString, ...rest } = request;
  return {
    ...scrubDeep(rest),
    ...(headers === undefined ? {} : { headers: scrubByKey(headers) }),
    ...(data === undefined ? {} : { data: scrubByKey(data) }),
    ...(queryString === undefined ? {} : { query_string: scrubQueryString(queryString) }),
  };
}

function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== 'object') return breadcrumb;
  const { data, ...rest } = breadcrumb;
  return {
    ...scrubDeep(rest),
    ...(data === undefined ? {} : { data: scrubByKey(data) }),
  };
}

function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const { request, breadcrumbs, user, ...rest } = event;
  const { ip_address: _ipAddress, ...userWithoutIp } = user || {};
  return {
    ...scrubDeep(rest),
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
  const dsn = env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
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
  if (!Sentry.isInitialized()) {
    exit(1);
    return;
  }

  try {
    Sentry.captureException(error, { level: 'fatal' });
  } catch {
    // Reporting is best effort; the exit below is not.
  }

  Sentry.flush(FLUSH_TIMEOUT_MS)
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
