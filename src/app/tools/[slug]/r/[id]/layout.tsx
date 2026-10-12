import { connection } from "next/server";

/**
 * Every report renders per request (s96, ADR 062).
 *
 * `/tools/<slug>/r/<id>` — that exact depth and nothing else — is served under
 * the nonce Content Security Policy (`NONCE_POLICY_PATH_PATTERNS` in
 * `src/lib/security/content-security-policy.ts`), because a report renders
 * text scraped off a stranger's page: escaping is the first defence, the nonce
 * the second. Next stamps the nonce on its scripts only while rendering a
 * request; prerendered, the page would have every script refused and never
 * hydrate. Keep the `connection()` call for as long as the pattern is there
 * (pinned by `src/__tests__/security/nonce-routes-render-dynamically.test.tsx`).
 *
 * The 404 below this layout (`not-found.tsx`) renders per request too, so a
 * missing report never serves the nonce-less static `/_not-found` under the
 * nonce policy (the s79 review F1 failure).
 */
export default async function ToolReportLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return children;
}
