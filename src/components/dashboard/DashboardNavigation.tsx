"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Globe,
  FileText,
  FlaskConical,
  BarChart3,
  Users,
  Settings,
  CreditCard,
  Menu,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  requiresPlan?: "pro" | "enterprise";
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Grouped rather than a flat list of eight. "Settings" and "Billing" are
 * account concerns and do not belong in the same run as the things you work on
 * every day.
 */
const navGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
      { label: "Sites", href: "/dashboard/sites", icon: Globe },
      { label: "Content", href: "/dashboard/content", icon: FileText },
      { label: "A/B Tests", href: "/dashboard/ab-tests", icon: FlaskConical },
      { label: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Account",
    items: [
      {
        label: "Teams",
        href: "/dashboard/teams",
        icon: Users,
        badge: "Pro",
        requiresPlan: "pro",
      },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
      { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
    ],
  },
];

interface DashboardNavigationProps {
  userPlan?: "free" | "pro" | "enterprise";
  className?: string;
}

export function DashboardNavigation({
  userPlan = "free",
  className,
}: DashboardNavigationProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const sidebarId = useId();

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const canAccessItem = (item: NavItem) => {
    if (!item.requiresPlan) return true;
    // "enterprise" early-return; after it TypeScript narrows userPlan to "free"|"pro"
    if (userPlan === "enterprise") return true;
    if (item.requiresPlan === "pro" && userPlan === "pro") return true;
    return false;
  };

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href);
    const accessible = canAccessItem(item);
    const Icon = item.icon;

    return (
      <Link
        href={accessible ? item.href : "#"}
        aria-current={active ? "page" : undefined}
        aria-disabled={!accessible || undefined}
        className={cn(
          "group relative flex min-h-10 items-center gap-3 rounded-md py-2 pl-3 pr-2.5 text-sm",
          "transition-[color,background-color] duration-200 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          active
            ? "bg-primary/12 font-medium text-primary"
            : "font-normal text-muted-foreground hover:bg-surface-2 hover:text-foreground",
          !accessible && "cursor-not-allowed opacity-45 hover:bg-transparent",
        )}
        onClick={(e) => {
          if (!accessible) {
            e.preventDefault();
          }
          if (isMobileMenuOpen) {
            setIsMobileMenuOpen(false);
          }
        }}
      >
        {/* A 2px rail rather than a chevron: it marks position without
            competing with the label, and it does not shift the row. */}
        <span
          className={cn(
            "absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity duration-200 ease-out",
            active ? "opacity-100" : "opacity-0",
          )}
          aria-hidden="true"
        />
        <Icon
          className="h-[1.125rem] w-[1.125rem] shrink-0"
          aria-hidden="true"
        />
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge && (
          <Badge variant="tone-neutral" size="sm">
            {item.badge}
          </Badge>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed left-4 top-4 z-50 lg:hidden"
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        aria-expanded={isMobileMenuOpen}
        aria-controls={sidebarId}
      >
        {isMobileMenuOpen ? (
          <X className="h-6 w-6" aria-hidden="true" />
        ) : (
          <Menu className="h-6 w-6" aria-hidden="true" />
        )}
        <span className="sr-only">
          {isMobileMenuOpen ? "Close navigation" : "Open navigation"}
        </span>
      </Button>

      {/* Mobile Overlay — tinted with the surface hue, not flat black. */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-[2px] lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <nav
        id={sidebarId}
        aria-label="Dashboard"
        className={cn(
          "fixed left-0 top-0 z-40 h-screen border-r border-border bg-card",
          "transition-transform duration-300 ease-out",
          "lg:w-64 lg:translate-x-0",
          isMobileMenuOpen ? "w-64 translate-x-0" : "-translate-x-full",
          className,
        )}
      >
        <div className="flex h-full flex-col">
          {/* Wordmark */}
          <div className="flex h-16 shrink-0 items-center px-5">
            <Link
              href="/dashboard"
              className="flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[0.6875rem] font-bold tracking-tight text-primary-foreground"
                aria-hidden="true"
              >
                RF
              </span>
              <span className="text-[0.9375rem] font-semibold tracking-[-0.015em] text-foreground">
                ReCopyFast
              </span>
            </Link>
          </div>

          {/* Navigation */}
          <div className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
            {navGroups.map((group) => (
              <div key={group.label}>
                <p className="text-eyebrow mb-2 px-3">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Plan */}
          <div className="shrink-0 p-3">
            <div className="rounded-lg border border-border bg-surface-1 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-eyebrow">Plan</p>
                  <p className="mt-1 text-sm font-medium capitalize text-foreground">
                    {userPlan}
                  </p>
                </div>
                {userPlan === "free" && (
                  <Button size="sm" variant="outline" asChild>
                    <Link href="/dashboard/billing">Upgrade</Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
