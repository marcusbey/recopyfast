/**
 * Next.js server instrumentation: the one place server and Edge Sentry start.
 *
 * This file must stay the ONLY instrumentation file, and it must stay in
 * `src/`. Until s46 (2026-09-26) there were two: a runtime-aware one at the
 * repo root and a stale one here that loaded the Node config on every runtime.
 * Next 16 builds with Turbopack, which looks for `instrumentation.*` at the
 * root before `src/`, so the root one ran; `next build --webpack` only scans
 * `src/` for a `src/app` layout, so it would have run this one. Which init
 * shipped depended on the bundler. `src/` is the only location both bundlers
 * load when it holds the only copy — a root file would silently shadow this
 * one again. `src/__tests__/instrumentation.test.ts` pins the layout.
 *
 * The file is compiled for both the Node and the Edge runtime, so it imports
 * only `@sentry/nextjs` (which resolves to its Edge build there) and picks the
 * runtime config dynamically. Loading the Node config on Edge — what the stale
 * copy did — reaches for `process.version` in an isolate that has no such thing.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Production-only, and only when a DSN is configured: dev and CI builds run
  // without one, and the configs' own `enabled` flag is production-only too.
  if (
    process.env.NODE_ENV !== "production" ||
    !process.env.NEXT_PUBLIC_SENTRY_DSN
  ) {
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    return;
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * Errors Next catches itself — route handlers, server components, middleware —
 * never reach a global handler, so without this export they never reached
 * Sentry either. Neither pre-s46 instrumentation file had it.
 */
export const onRequestError = Sentry.captureRequestError;
