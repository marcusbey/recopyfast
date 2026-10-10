import type { Metadata } from "next";
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

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <DashboardFrame>{children}</DashboardFrame>;
}
