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
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  requiresPlan?: "pro" | "enterprise";
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Sites",
    href: "/dashboard/sites",
    icon: Globe,
  },
  {
    label: "Content",
    href: "/dashboard/content",
    icon: FileText,
  },
  {
    label: "A/B Tests",
    href: "/dashboard/ab-tests",
    icon: FlaskConical,
  },
  {
    label: "Analytics",
    href: "/dashboard/analytics",
    icon: BarChart3,
  },
  {
    label: "Teams",
    href: "/dashboard/teams",
    icon: Users,
    badge: "Pro",
    badgeVariant: "secondary",
    requiresPlan: "pro",
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
  },
  {
    label: "Billing",
    href: "/dashboard/billing",
    icon: CreditCard,
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
          "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          active
            ? "bg-primary/10 text-primary"
            : "text-foreground/80 hover:bg-muted hover:text-foreground",
          !accessible && "cursor-not-allowed opacity-50",
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
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="flex-1">{item.label}</span>
        {item.badge && (
          <Badge variant={item.badgeVariant || "default"} className="text-xs">
            {item.badge}
          </Badge>
        )}
        {active && <ChevronRight className="h-4 w-4" aria-hidden="true" />}
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

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <nav
        id={sidebarId}
        aria-label="Dashboard"
        className={cn(
          "fixed left-0 top-0 z-40 h-screen border-r border-border bg-card transition-transform duration-300",
          "lg:w-64 lg:translate-x-0",
          isMobileMenuOpen ? "w-64 translate-x-0" : "-translate-x-full",
          className,
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo/Brand */}
          <div className="border-b border-border p-6">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <span className="text-sm font-bold text-primary-foreground">
                  RF
                </span>
              </div>
              <span className="text-xl font-bold text-foreground">
                ReCopyFast
              </span>
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-1">
              {navItems.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </div>

          {/* Plan Badge */}
          <div className="border-t border-border p-4">
            <div className="flex items-center justify-between rounded-lg bg-surface-1 p-3">
              <div>
                <p className="text-xs text-muted-foreground">Current Plan</p>
                <p className="text-sm font-semibold capitalize text-foreground">
                  {userPlan}
                </p>
              </div>
              {userPlan === "free" && (
                <Button size="sm" variant="outline" className="text-xs" asChild>
                  <Link href="/dashboard/billing">Upgrade</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
