"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href: string;
}

export function Breadcrumbs() {
  const pathname = usePathname();

  const generateBreadcrumbs = (): BreadcrumbItem[] => {
    const paths = pathname.split("/").filter(Boolean);
    const breadcrumbs: BreadcrumbItem[] = [];

    // Always start with dashboard
    if (paths[0] === "dashboard") {
      breadcrumbs.push({ label: "Dashboard", href: "/dashboard" });

      // Add subsequent paths
      for (let i = 1; i < paths.length; i++) {
        const path = paths[i];
        const href = `/dashboard/${paths.slice(1, i + 1).join("/")}`;
        const label = path
          .split("-")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");

        breadcrumbs.push({ label, href });
      }
    }

    return breadcrumbs;
  };

  const breadcrumbs = generateBreadcrumbs();

  if (breadcrumbs.length === 0) {
    return null;
  }

  // Everything after the "Dashboard" root.
  const trail = breadcrumbs.slice(1);

  // On /dashboard itself the trail is empty, which would render a single
  // breadcrumb linking to the page the user is already on — navigation that
  // leads nowhere. Render nothing at the root instead.
  if (trail.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
    >
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center gap-2 rounded-sm transition-colors duration-200 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        aria-current={trail.length === 0 ? "page" : undefined}
      >
        <Home className="h-4 w-4" aria-hidden="true" />
        <span
          className={trail.length === 0 ? "font-medium text-foreground" : ""}
        >
          Dashboard
        </span>
      </Link>

      {trail.map((crumb, index) => {
        const isLast = index === trail.length - 1;

        return (
          <div key={crumb.href} className="flex min-w-0 items-center gap-2">
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 opacity-60"
              aria-hidden="true"
            />
            {isLast ? (
              <span
                aria-current="page"
                className="truncate font-medium text-foreground"
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="truncate rounded-sm transition-colors duration-200 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {crumb.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
