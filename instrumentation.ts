/**
 * Next.js instrumentation entrypoint.
 *
 * Keep this file Edge-safe: Next builds it for both Node and Edge instrumentation.
 * Node-only monitoring should live in runtime-specific server modules or API routes.
 */
export async function register() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SENTRY_DSN) {
    if (process.env.NEXT_RUNTIME === "edge") {
      await import("./sentry.edge.config");
      return;
    }

    await import("./sentry.server.config");
  }
}
