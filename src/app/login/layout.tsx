import type { Metadata } from "next";

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

export default function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
