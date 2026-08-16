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
 *   1. On a non-production Vercel deployment, the hostname the platform gave
 *      THIS deployment. See `resolveDeploymentOrigin` for why it outranks the
 *      configured app URL there, and only there.
 *   2. NEXT_PUBLIC_APP_URL — configured by us, not by the request. Canonical.
 *   3. x-forwarded-host, but ONLY if it matches a hostname Vercel injected.
 *   4. The request's own origin — correct locally, where there is no proxy.
 *
 * Anything else is discarded rather than followed.
 */

import {
  deploymentHosts,
  normalizeHost,
  resolveDeploymentOrigin,
} from "@/lib/deployment/origin";

/**
 * Say something when a developer is about to be redirected off their own machine.
 *
 * The register's row 2.6: confirming a magic link against localhost signed the
 * session in LOCALLY and then redirected to https://www.recopyfa.st, where that
 * cookie does not exist — so the developer arrived logged out with no clue why.
 * `.env` carries the production URL, and preferring it is the correct
 * anti-open-redirect posture, so the fix is configuration (a local `.env.local`)
 * rather than code.
 *
 * What code CAN do is stop the misconfiguration being silent. This is the one
 * moment we know both values, and a developer who sees this line will fix it in
 * seconds instead of losing an afternoon.
 *
 * Development only, and deliberately not an error: in production the request
 * host legitimately differs from the canonical origin (apex vs www, a proxy, a
 * custom domain), and warning on every one of those would be noise that trains
 * people to ignore the log.
 */
function warnIfConfiguredOriginIsElsewhere(
  request: Request,
  configuredOrigin: string,
): void {
  if (process.env.NODE_ENV === "production") return;

  try {
    const requestHost = new URL(request.url).host.toLowerCase();
    const configuredHost = new URL(configuredOrigin).host.toLowerCase();
    if (requestHost === configuredHost) return;

    console.warn(
      `[auth] This request arrived on ${requestHost} but NEXT_PUBLIC_APP_URL is ` +
        `${configuredOrigin}, so you are about to be redirected there — where the ` +
        `session cookie just set for ${requestHost} does not exist, and you will ` +
        `land signed out. Set NEXT_PUBLIC_APP_URL in .env.local to ` +
        `http://${requestHost}. See docs/operations/deployment-env.md.`,
    );
  } catch {
    // A URL we cannot parse is not worth warning about.
  }
}

export function resolvePublicOrigin(request: Request): string {
  const forwardedHost = normalizeHost(request.headers.get("x-forwarded-host"));

  const deploymentOrigin = resolveDeploymentOrigin(forwardedHost);
  if (deploymentOrigin) return deploymentOrigin;

  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      const configuredOrigin = new URL(configured).origin;
      warnIfConfiguredOriginIsElsewhere(request, configuredOrigin);
      return configuredOrigin;
    } catch {
      // Malformed config — fall through rather than redirect somewhere broken.
    }
  }

  const requestOrigin = new URL(request.url).origin;

  // No configured app URL (e.g. a preview deployment). Accept x-forwarded-host
  // only when it matches a hostname the platform itself injected.
  if (forwardedHost) {
    const trusted = new Set(
      [
        ...deploymentHosts(),
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
