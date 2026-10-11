import type { Metadata } from "next";
import { connection } from "next/server";

/**
 * /signup is a bare account form; every conversion path (homepage, pricing,
 * comparisons) links to it, and none of them needs it to rank. Same treatment
 * as /login: `noindex, follow`, crawlable, out of the sitemap. The page is a
 * client component, so the segment's layout carries the metadata (s88).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

/**
 * Every page of this segment renders per request (s79, ADR 059).
 *
 * /signup takes a new password, so it is served under the nonce Content Security
 * Policy, and Next stamps the nonce on its scripts only while rendering a
 * request. Prerendered, as it was until s79, the page would have every script
 * refused under that policy and never hydrate. Keep the `connection()` call
 * for as long as the path is in `NONCE_POLICY_PATH_PREFIXES`
 * (`src/lib/security/content-security-policy.ts`).
 */
export default async function SignupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return children;
}
