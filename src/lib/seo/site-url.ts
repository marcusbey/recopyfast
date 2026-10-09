/**
 * Canonical origin used by generated public discovery surfaces.
 *
 * Sitemap and robots carried byte-for-byte copies of this resolver. `llms.txt`
 * would have been a third, which is where a harmless-looking fallback starts
 * drifting into different canonical hosts depending on which crawler asks.
 */
export function resolveSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  return withScheme.replace(/\/+$/, "");
}
