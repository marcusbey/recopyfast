"use client";

import { useAuth } from "@/contexts/AuthContext";
import {
  DashboardNavigation,
  isDashboardPlan,
  type DashboardPlan,
} from "@/components/dashboard/DashboardNavigation";
import { Breadcrumbs } from "@/components/dashboard/Breadcrumbs";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { User, LogOut, Settings } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [userPlan, setUserPlan] = useState<DashboardPlan>("free");

  useEffect(() => {
    if (!loading && !user) {
      // Must be `redirectedFrom`: that is the key `src/middleware.ts` sets and
      // the only one `LoginForm` reads. Sending `next` here silently dropped
      // the destination and landed everyone on /dashboard after sign-in.
      const redirectedFrom = encodeURIComponent(pathname ?? "/dashboard");
      router.push(`/login?redirectedFrom=${redirectedFrom}`);
    }
  }, [user, loading, router, pathname]);

  useEffect(() => {
    if (!user) return;
    // user_metadata is client-writable in Supabase, so an unrecognised value
    // must fall back to free rather than being trusted into the nav gate.
    const plan = user.user_metadata?.plan;
    setUserPlan(isDashboardPlan(plan) ? plan : "free");
  }, [user]);

  // A skeleton in the shape of the shell, so the page does not flash from a
  // centred spinner into a two-column layout.
  if (loading) {
    return (
      <div
        className="min-h-screen bg-background"
        role="status"
        aria-label="Loading dashboard"
      >
        <div className="hidden lg:block">
          <div className="fixed left-0 top-0 h-screen w-64 border-r border-border bg-card p-4">
            <Skeleton className="mb-8 h-8 w-32" />
            <div className="space-y-2">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </div>
        </div>
        <div className="lg:pl-64">
          <div className="h-16 border-b border-border bg-card" />
          <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 sm:p-6 lg:p-8">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const displayName = user.user_metadata?.name || user.email || "User";
  const getUserInitials = () => displayName.charAt(0).toUpperCase();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      <DashboardNavigation userPlan={userPlan} />

      <div className="lg:pl-64">
        {/* The header carries location (breadcrumbs), not a greeting. It used
            to read "Welcome back!" on every screen, directly above each page's
            own h1 — two competing titles saying nothing about where you are. */}
        <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="w-10 shrink-0 lg:hidden" />
              <Breadcrumbs />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-9 w-9 shrink-0 rounded-full p-0"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-surface-2 text-sm font-semibold text-foreground">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="sr-only">Open account menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="truncate text-sm font-medium leading-none">
                      {user.user_metadata?.name || "Your account"}
                    </p>
                    <p className="truncate text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href="/dashboard/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>Settings</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/dashboard/billing" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>Billing</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* A measure. Without a max-width the stat row stretched to whatever the
            monitor was, and 1600px-wide cards holding a two-digit number is not
            a layout. */}
        <main
          id="dashboard-main"
          className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
