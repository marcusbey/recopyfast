/**
 * Browser Sentry: runs before the app hydrates, on every page.
 *
 * This used to live in `sentry.client.config.ts`, which only Sentry's webpack
 * entry injection ever loads. Next 16 builds with Turbopack, so that file was
 * never bundled: production shipped no browser SDK at all, the DSN's public key
 * was absent from every chunk, and on 2026-09-26 an uncaught error on the live
 * site sent nothing (s46). `instrumentation-client.ts` is the entry Next itself
 * loads under either bundler. Keep the name and the location: under Turbopack,
 * Sentry injects its build-time values (tunnel path, route manifest) only into
 * files matching `**\/instrumentation-client.*`, and `src/` is where the server
 * instrumentation lives too (see `src/instrumentation.ts`).
 *
 * Do not recreate `sentry.client.config.ts` beside this file: webpack builds
 * inject both, and Sentry.init runs twice.
 *
 * Events leave through the same-origin tunnel set by `tunnelRoute` in
 * next.config.ts (see `src/lib/monitoring/sentry-tunnel.ts`), so the CSP's
 * `connect-src 'self'` covers them and ad blockers keyed on sentry.io do not.
 */

import * as Sentry from "@sentry/nextjs";
import { releaseOption } from "@/lib/monitoring/sentry-release";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,

  // Environment configuration
  environment:
    process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || "development",

  // Only enable in production
  enabled: process.env.NODE_ENV === "production",

  // Performance Monitoring. Browser tracing stays, on a measured cost. The
  // operator's bar (2026-09-26) was to keep it only if it cost at most 20 KB
  // gzip over an errors-only init. It costs 58 B: @sentry/nextjs's own `init`
  // imports browserTracingIntegration as a default integration either way.
  // Even the tracing code itself, strippable only at build time with a
  // `__SENTRY_TRACING__: false` define (a next.config decision, not taken), is
  // 16,734 B. That is under the bar.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Release tracking: the build's commit SHA, the same value server and Edge
  // report (s84, src/lib/monitoring/sentry-release.ts). Spread, never
  // `release: undefined` — that would erase the SDK's own fallback.
  ...releaseOption(process.env.NEXT_PUBLIC_SENTRY_RELEASE),

  // No Session Replay, deliberately. The operator ruled on 2026-09-26 that launch
  // landing pages cannot carry it and that error reporting is the goal. Replay
  // sat in `sentry.client.config.ts`, which was never bundled, so it cost nothing
  // until s46 shipped this file. It then made up 38,965 B gzip of the +121,922 B
  // the SDK added to every page's first load: shared JS measured 253,686 B with
  // it and 214,721 B without.
  //
  // Re-adding Replay is a later decision, not a revert. The route is to load it
  // lazily after init, with `Sentry.lazyLoadIntegration("replayIntegration")` and
  // `Sentry.addIntegration`. Keep `maskAllText`, `maskAllInputs` and
  // `blockAllMedia`: replays render customer websites and their visitors'
  // personal data. `lazyLoadIntegration` injects a <script> from
  // https://browser.sentry-cdn.com, which the CSP's `script-src 'self'` blocks,
  // so that decision includes the CSP.
  integrations: [Sentry.browserTracingIntegration()],

  // Filtering
  ignoreErrors: [
    // Browser errors
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",

    // Network errors
    "NetworkError",
    "Network request failed",
    "Failed to fetch",

    // User canceled actions
    "The user aborted a request",
    "User cancelled",
    "Request aborted",

    // Common extension errors
    "Extension context invalidated",
    "Cannot access dead object",
  ],

  beforeSend(event, hint) {
    // Filter out non-critical errors
    if (event.exception) {
      const error = hint.originalException as Error | undefined;

      // Ignore errors from browser extensions
      if (error?.stack?.includes("chrome-extension://")) {
        return null;
      }

      // Ignore errors from third-party scripts
      if (
        error?.stack &&
        (error.stack.includes("gtm.js") ||
          error.stack.includes("analytics.js") ||
          error.stack.includes("fbevents.js"))
      ) {
        return null;
      }
    }

    // Attach only a non-PII user id for correlation. Email is personal data and
    // must not be shipped to Sentry — id alone is enough to join with our own logs.
    const user =
      typeof window !== "undefined"
        ? window.localStorage.getItem("user")
        : null;
    if (user) {
      try {
        const userData = JSON.parse(user);
        if (userData?.id) {
          event.user = { id: userData.id };
        }
      } catch {
        // Ignore parse errors
      }
    }

    return event;
  },

  // Custom tags
  initialScope: {
    tags: {
      component: "client",
    },
  },
});

// Names each client-side navigation as its own transaction. Without this
// export the SDK prints an "ACTION REQUIRED" warning at build time and App
// Router navigations go untraced.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
