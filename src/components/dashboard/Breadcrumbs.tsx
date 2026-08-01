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

  if (breadcrumbs.length === 0 || pathname === "/dashboard") {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-6 flex items-center space-x-2 text-sm text-muted-foreground"
    >
      <Link
        href="/dashboard"
        className="flex items-center rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Home className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Dashboard home</span>
      </Link>

      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;

        return (
          <div key={crumb.href} className="flex items-center space-x-2">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            {isLast ? (
              <span aria-current="page" className="font-medium text-foreground">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
