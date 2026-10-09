import type { Metadata } from "next";

/**
 * /signup is a bare account form; every conversion path (homepage, pricing,
 * comparisons) links to it, and none of them needs it to rank. Same treatment
 * as /login: `noindex, follow`, crawlable, out of the sitemap. The page is a
 * client component, so the segment's layout carries the metadata (s88).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function SignupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
