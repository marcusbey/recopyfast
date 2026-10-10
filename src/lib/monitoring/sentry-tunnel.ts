/**
 * The same-origin path the browser posts its Sentry events to.
 *
 * `next.config.ts` hands it to `withSentryConfig` as `tunnelRoute`, which adds
 * a rewrite from this path to Sentry's ingest and tells the browser SDK to use
 * it. `src/middleware.ts` lets it through without a session lookup. Both read
 * this one constant because they must agree: a middleware still keyed to an old
 * path would spend a GoTrue round trip on every error event, and could write a
 * rotated session cookie onto Sentry's response.
 *
 * Imported by next.config.ts with a relative path, so this module must stay
 * free of `@/` imports and of anything that needs the app runtime.
 */
export const SENTRY_TUNNEL_ROUTE = "/monitoring";
