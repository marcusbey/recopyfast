"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

/**
 * A site's four pages, in order (s66c1, ADR 052). Every link to a site page
 * is built from here, so a renamed segment cannot leave one caller behind.
 */
export const SITE_PAGES = [
  { segment: "", label: "Overview" },
  { segment: "install", label: "Install" },
  { segment: "people", label: "People & access" },
  { segment: "settings", label: "Settings" },
] as const;

export type SitePageSegment = (typeof SITE_PAGES)[number]["segment"];

export function sitePageHref(
  siteId: string,
  segment: SitePageSegment = "",
): string {
  const base = `/dashboard/sites/${siteId}`;
  return segment ? `${base}/${segment}` : base;
}

/**
 * The site sub-navigation, in `PageShell`'s `nav` slot (ADR 053).
 *
 * Links, not tabs: each subpage is its own URL, so a link pushes history and
 * Back and Forward walk the subpages the way the owner asked ("subpages",
 * 2026-10-08); Back from Overview returns to Sites. It wears the Tabs
 * trigger's look (design system, Controls: 40px, a 2px `primary` underline on
 * the current one) and wraps rather than clipping when narrow.
 */
export function SiteSubnav({ siteId }: { siteId: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Site"
      className="flex flex-wrap items-end gap-x-4 border-b border-border text-muted-foreground"
    >
      {SITE_PAGES.map(({ segment, label }) => {
        const href = sitePageHref(siteId, segment);
        const isCurrent = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-none border-b-2 border-transparent px-0.5 text-sm font-medium",
              "transition-[color,border-color] duration-200 ease-out hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isCurrent && "border-primary text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
