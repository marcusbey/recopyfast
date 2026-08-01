"use client";

import { useAuth } from "@/contexts/AuthContext";
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation";
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
import { User, LogOut, Settings } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [userPlan, setUserPlan] = useState<"free" | "pro" | "enterprise">(
    "free",
  );

  useEffect(() => {
    if (!loading && !user) {
      const next = encodeURIComponent(pathname ?? "/dashboard");
      router.push(`/login?next=${next}`);
    }
  }, [user, loading, router, pathname]);

  useEffect(() => {
    // Fetch user plan from API or user metadata
    if (user) {
      const plan = user.user_metadata?.plan || "free";
      setUserPlan(plan);
    }
  }, [user]);

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-surface-1"
        role="status"
        aria-label="Loading dashboard"
      >
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const getUserInitials = () => {
    const name = user.user_metadata?.name || user.email || "User";
    return name.charAt(0).toUpperCase();
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  return (
    <div className="min-h-screen bg-surface-1">
      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      {/* Sidebar Navigation */}
      <DashboardNavigation userPlan={userPlan} />

      {/* Main Content */}
      <div className="lg:pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-border bg-card">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-4">
              <div className="w-12 lg:hidden" />
              <div>
                <h1 className="text-xl font-semibold text-foreground">
                  Welcome back!
                </h1>
              </div>
            </div>

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-10 w-10 rounded-full"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="sr-only">Open account menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {user.user_metadata?.name || "User"}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href="/dashboard/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/dashboard/billing" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    <span>Billing</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main id="dashboard-main" className="p-4 sm:p-6">
          <Breadcrumbs />
          {children}
        </main>
      </div>
    </div>
  );
}
