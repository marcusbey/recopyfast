import type { Metadata } from "next";
import { connection } from "next/server";

/**
 * /login is a bare sign-in form: nothing on it answers a search, and brand
 * searches land on the homepage. It is `noindex` but stays crawlable (robots.txt
 * does not block it) so the noindex can be read, and `follow` lets its links to
 * the legal pages count. The page is a client component, so the segment's
 * layout carries the metadata (s88). It is not in the sitemap.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

/**
 * Every page of this segment renders per request (s79, ADR 059).
 *
 * /login takes a password, so it is served under the nonce Content Security
 * Policy, and Next stamps the nonce on its scripts only while rendering a
 * request. Prerendered, as it was until s79, the page would have every script
 * refused under that policy and never hydrate. Keep the `connection()` call
 * for as long as the path is in `NONCE_POLICY_PATH_PREFIXES`
 * (`src/lib/security/content-security-policy.ts`).
 */
export default async function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return children;
}
