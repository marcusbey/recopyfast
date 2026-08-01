/**
 * Resolve the public origin to redirect to after an auth callback.
 *
 * Behind a load balancer (Vercel) `request.url` carries the *internal* origin,
 * so redirecting to it would send the user somewhere that is not the public
 * hostname. The usual fix is to read `x-forwarded-host` — but that header is
 * attacker-controllable unless the proxy is known to overwrite it, and these
 * routes redirect AFTER the session cookie has been set. An unvalidated value
 * therefore hands a freshly-authenticated user to an arbitrary origin.
 *
 * So resolve in order of trustworthiness:
 *   1. NEXT_PUBLIC_APP_URL — configured by us, not by the request. Canonical.
 *   2. x-forwarded-host, but ONLY if it matches a host we already trust
 *      (the configured app URL, or the Vercel-injected deployment hostnames).
 *   3. The request's own origin — correct locally, where there is no proxy.
 *
 * Anything else is discarded rather than followed.
 */
function normalizeHost(value: string | undefined | null): string | null {
  if (!value) return null;
  const withScheme = value.includes("://") ? value : `https://${value}`;
  try {
    return new URL(withScheme).host.toLowerCase();
  } catch {
    return null;
  }
}

export function resolvePublicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Malformed config — fall through rather than redirect somewhere broken.
    }
  }

  const requestOrigin = new URL(request.url).origin;

  // No configured app URL (e.g. a preview deployment). Accept x-forwarded-host
  // only when it matches a hostname the platform itself injected.
  const forwardedHost = normalizeHost(request.headers.get("x-forwarded-host"));
  if (forwardedHost) {
    const trusted = new Set(
      [
        normalizeHost(process.env.VERCEL_URL),
        normalizeHost(process.env.VERCEL_BRANCH_URL),
        normalizeHost(process.env.VERCEL_PROJECT_PRODUCTION_URL),
      ].filter((host): host is string => Boolean(host)),
    );

    if (trusted.has(forwardedHost)) {
      return `https://${forwardedHost}`;
    }

    console.warn(
      `[auth] ignoring untrusted x-forwarded-host "${forwardedHost}"; ` +
        `falling back to the request origin. Set NEXT_PUBLIC_APP_URL to the ` +
        `public origin to make this deterministic.`,
    );
  }

  return requestOrigin;
}
