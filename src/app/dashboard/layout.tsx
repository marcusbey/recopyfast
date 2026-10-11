import type { Metadata } from "next";
import { connection } from "next/server";
import { DashboardFrame } from "./DashboardFrame";

/**
 * Nothing in the dashboard belongs in a search index. `next.config.ts` already
 * sends `X-Robots-Tag: noindex, nofollow` on every `/dashboard` response; until
 * s88's review the HTML said the opposite — it inherited the root layout's
 * `<meta name="robots" content="index, follow">`, because this layout was a
 * client component and could not export metadata. A child's `robots` replaces
 * the parent's whole object, so the page now says what the header says
 * (`src/__tests__/app/seo-canonicals.test.ts`).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Every dashboard page renders per request, on purpose (s79, ADR 059).
 *
 * The dashboard is served under the nonce Content Security Policy, and Next
 * can stamp that nonce on its scripts only while rendering a request. Most
 * dashboard pages are client components with no request data, so Next used to
 * prerender them at build time — and a prerendered page under the nonce policy
 * has every script refused and never hydrates. Awaiting `connection()` here,
 * in the segment's layout, makes every page below it dynamic, including pages
 * added later. Do not remove it to "make the dashboard static again": the
 * nonce policy in `src/middleware.ts` would then break the whole segment, in
 * production builds only.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return <DashboardFrame>{children}</DashboardFrame>;
}
