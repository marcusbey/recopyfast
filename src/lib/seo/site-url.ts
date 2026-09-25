/**
 * Canonical origin used to build absolute SEO URLs.
 *
 * Resolution order: the explicitly configured app URL, then Vercel's stable
 * production domain, then the per-deployment URL, then the dev fallback.
 * Vercel exposes its URL vars as bare hostnames, but this project's `.env`
 * sets `VERCEL_URL` with a scheme, so both shapes are accepted.
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
