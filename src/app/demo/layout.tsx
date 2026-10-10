import type { Metadata } from "next";

/**
 * Metadata for /demo. The page is a client component (it runs the interactive
 * hero), and a client module cannot export `metadata`, so the segment's layout
 * carries it. Without it /demo inherited the homepage's canonical until s88.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/demo" },
};

export default function DemoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
