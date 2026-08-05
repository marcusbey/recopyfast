/**
 * Which origin the deployment that is actually serving this request answers to.
 *
 * WHY THIS IS SHARED RATHER THAN LOCAL TO AUTH
 * --------------------------------------------
 * Register F-14 names two bounces in one breath: "preview auth and preview
 * Stripe returns both bounce users to production." They are the same defect
 * reached by two routes, so a fix that lives inside the auth module closes
 * exactly half of it — and leaves the halves disagreeing, which is worse than
 * either being wrong consistently. A customer who pays on a preview would be
 * signed in on the preview host and returned to production, where the cookie
 * they were just issued does not exist.
 *
 * So the rule lives here, and `src/app/auth/public-origin.ts` and
 * `src/lib/stripe/checkout.ts` both read it.
 *
 * WHY IT MAY OUTRANK NEXT_PUBLIC_APP_URL
 * --------------------------------------
 * `NEXT_PUBLIC_*` variables are inlined at build time, and a Vercel project
 * normally defines NEXT_PUBLIC_APP_URL once and lets every environment inherit
 * it — so a preview deployment ships the PRODUCTION origin baked into its
 * bundle. VERCEL_ENV, VERCEL_URL and VERCEL_BRANCH_URL are set by the platform
 * per deployment and read at runtime, so they describe the deployment that is
 * serving rather than the one that happened to be configured.
 *
 * None of them comes from the request. That is what makes ranking them above
 * the configured URL a change of PREFERENCE and not a change of TRUST: a
 * request header is still only believed when the platform corroborates it.
 */

/** Values Vercel assigns to VERCEL_ENV: production, preview, or development. */
const VERCEL_PRODUCTION = "production";
const VERCEL_DEVELOPMENT = "development";

export function normalizeHost(value: string | undefined | null): string | null {
  if (!value) return null;
  const withScheme = value.includes("://") ? value : `https://${value}`;
  try {
    return new URL(withScheme).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True on a Vercel deployment that is neither production nor `vercel dev`.
 *
 * Both exclusions are load-bearing. VERCEL_ENV unset means we are not on Vercel
 * at all — a laptop, CI, or a self-hosted box — and this project's local `.env`
 * sets VERCEL_URL by hand to the production domain, so inferring a deployment
 * from VERCEL_URL alone would send every local sign-in to production. And
 * "development" is `vercel dev` on that same laptop, where VERCEL_URL is
 * `localhost:3000` served over http; forcing an https origin from it would
 * break local sign-in rather than fix anything.
 */
export function isNonProductionDeployment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (!vercelEnv) return false;
  return vercelEnv !== VERCEL_PRODUCTION && vercelEnv !== VERCEL_DEVELOPMENT;
}

/**
 * Hostnames Vercel assigned to the deployment serving this request, most
 * specific first: the per-deployment URL, then the branch URL. Vercel supplies
 * both as bare hostnames; `normalizeHost` also tolerates the scheme-prefixed
 * shape this project's local `.env` uses.
 */
export function deploymentHosts(): readonly string[] {
  return [
    normalizeHost(process.env.VERCEL_URL),
    normalizeHost(process.env.VERCEL_BRANCH_URL),
  ].filter((host): host is string => Boolean(host));
}

/**
 * The origin of a non-production deployment, or null when this is not one.
 *
 * `forwardedHost` is optional because the two callers know different amounts.
 * An auth redirect is handling a request and can prefer the hostname it
 * arrived on; Stripe return URLs are built while creating a Checkout Session
 * and legitimately have no request in hand, so they take the deployment's own
 * hostname. Passing null is therefore a real answer, not a missing one.
 */
export function resolveDeploymentOrigin(
  forwardedHost: string | null = null,
): string | null {
  if (!isNonProductionDeployment()) return null;

  const hosts = deploymentHosts();
  if (hosts.length === 0) return null;

  if (forwardedHost) {
    // Stay on the hostname the request arrived on when this deployment answers
    // to it: the session cookie was written for that host moments ago, so
    // hopping to a sibling hostname signs the user straight back out.
    //
    // A hostname we do not recognise is handed back to the normal order rather
    // than overruled. It is most likely an alias pointed at previews, for which
    // NEXT_PUBLIC_APP_URL may well have been set deliberately — and it is a
    // request header, so it is not ours to follow either way.
    return hosts.includes(forwardedHost) ? `https://${forwardedHost}` : null;
  }

  return `https://${hosts[0]}`;
}
