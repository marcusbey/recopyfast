import { connection } from "next/server";

/**
 * Every page of this segment renders per request (s79, ADR 059).
 *
 * /edit is where an invited editor signs in, so it is served under the nonce Content Security
 * Policy, and Next stamps the nonce on its scripts only while rendering a
 * request. Prerendered, as it was until s79, the page would have every script
 * refused under that policy and never hydrate. Keep the `connection()` call
 * for as long as the path is in `NONCE_POLICY_PATH_PREFIXES`
 * (`src/lib/security/content-security-policy.ts`).
 */
export default async function EditLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return children;
}
