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

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,

  // Environment configuration
  environment:
    process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || "development",

  // Only enable in production
  enabled: process.env.NODE_ENV === "production",

  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Session Replay
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors

  // Release tracking
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

  // Integrations
  integrations: [
    Sentry.replayIntegration({
      // Mask all text + media in session replays. Recopyfast replays render
      // customer website content (potentially their end-users' PII); capturing it
      // unmasked would route third-party personal data into our error tooling.
      maskAllText: true,
      blockAllMedia: true,
      maskAllInputs: true,
    }),
    Sentry.browserTracingIntegration(),
  ],

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
