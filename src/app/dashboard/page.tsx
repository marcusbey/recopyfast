"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { SiteRegistrationModal } from "@/components/dashboard/SiteRegistrationModal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Clock,
  FileText,
  Globe,
  History,
  Loader2,
  Plus,
  Settings as SettingsIcon,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SiteStatus } from "@/components/dashboard/SiteCard";

const RECENT_SITES_LIMIT = 5;

/** Shape actually returned by `GET /api/sites` (not the full `Site` row). */
interface DashboardSite {
  id: string;
  name: string;
  domain: string;
  created_at: string;
  updated_at: string;
  status?: SiteStatus;
  stats?: {
    edits_count?: number;
    content_elements_count?: number;
    last_activity?: string | null;
  };
}

type LoadState = "loading" | "ready" | "error";

const statusBadgeVariant: Record<
  SiteStatus,
  "success-outline" | "warning-outline" | "outline"
> = {
  active: "success-outline",
  verifying: "warning-outline",
  inactive: "outline",
};

const statusLabel: Record<SiteStatus, string> = {
  active: "Active",
  verifying: "Verifying",
  inactive: "Inactive",
};

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  /** Formatted value, or `null` when the source could not supply one. */
  value: string | null;
  state: LoadState;
  color: string;
  href: string;
  valueClassName?: string;
}

function StatCard({
  icon: Icon,
  label,
  value,
  state,
  color,
  href,
  valueClassName = "text-2xl",
}: StatCardProps) {
  return (
    <Link href={href}>
      <Card className="border-border hover:shadow-lg transition-shadow cursor-pointer h-full">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{label}</p>
              {state === "loading" && (
                <div className="h-7 w-16 bg-muted rounded animate-pulse mt-1" />
              )}
              {state === "error" && (
                <p className="text-sm text-muted-foreground mt-2">
                  Unavailable
                </p>
              )}
              {state === "ready" &&
                (value === null ? (
                  <p className="text-sm text-muted-foreground mt-2">
                    Unavailable
                  </p>
                ) : (
                  <p
                    className={`${valueClassName} font-bold text-foreground truncate`}
                  >
                    {value}
                  </p>
                ))}
            </div>
            <div
              className={`w-12 h-12 bg-gradient-to-r ${color} rounded-xl flex items-center justify-center flex-shrink-0`}
            >
              <Icon className="w-6 h-6 text-white" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [sites, setSites] = useState<DashboardSite[]>([]);
  const [sitesState, setSitesState] = useState<LoadState>("loading");
  const [sitesError, setSitesError] = useState<string | null>(null);

  // AI usage lives in the billing tracker, not in /api/sites.
  const [aiSuggestions, setAiSuggestions] = useState<number | null>(null);
  const [aiState, setAiState] = useState<LoadState>("loading");

  const fetchSites = useCallback(async () => {
    try {
      setSitesState("loading");
      setSitesError(null);
      const response = await fetch("/api/sites");

      if (!response.ok) {
        throw new Error("Failed to fetch sites");
      }

      const data: { sites?: DashboardSite[] } = await response.json();
      setSites(data.sites ?? []);
      setSitesState("ready");
    } catch (err) {
      console.error("Error fetching sites:", err);
      setSitesError(
        err instanceof Error ? err.message : "Failed to load sites",
      );
      setSitesState("error");
    }
  }, []);

  const fetchAiUsage = useCallback(async () => {
    try {
      setAiState("loading");
      const response = await fetch("/api/billing/dashboard");

      if (!response.ok) {
        throw new Error(`Billing dashboard responded ${response.status}`);
      }

      const data: { currentUsage?: { aiUsage?: number } } =
        await response.json();
      const usage = data.currentUsage?.aiUsage;

      if (typeof usage !== "number") {
        throw new Error("AI usage missing from billing dashboard response");
      }

      setAiSuggestions(usage);
      setAiState("ready");
    } catch (err) {
      console.error("Error fetching AI usage:", err);
      setAiSuggestions(null);
      setAiState("error");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void fetchSites();
    void fetchAiUsage();
  }, [user, fetchSites, fetchAiUsage]);

  const activeSiteCount = useMemo(
    () => sites.filter((site) => site.status === "active").length,
    [sites],
  );

  const totalEdits = useMemo(
    () => sites.reduce((sum, site) => sum + (site.stats?.edits_count ?? 0), 0),
    [sites],
  );

  const lastActivity = useMemo(() => {
    const timestamps = sites
      .map((site) => site.stats?.last_activity)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((time) => !Number.isNaN(time));

    return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
  }, [sites]);

  const recentSites = useMemo(
    () =>
      [...sites]
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        .slice(0, RECENT_SITES_LIMIT),
    [sites],
  );

  const handleSiteRegistrationSuccess = () => {
    setIsModalOpen(false);
    void fetchSites();
  };

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Welcome back
          {user?.user_metadata?.name ? `, ${user.user_metadata.name}` : ""}!
        </h1>
        <p className="text-muted-foreground">
          Manage your sites and view analytics from your dashboard.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={Globe}
          label="Active Sites"
          value={String(activeSiteCount)}
          state={sitesState}
          color="from-blue-500 to-cyan-500"
          href="/dashboard/sites"
        />
        <StatCard
          icon={History}
          label="Total Edits"
          value={String(totalEdits)}
          state={sitesState}
          color="from-purple-500 to-pink-500"
          href="/dashboard/content"
        />
        <StatCard
          icon={Zap}
          label="AI Suggestions (30d)"
          value={aiSuggestions === null ? null : String(aiSuggestions)}
          state={aiState}
          color="from-yellow-500 to-orange-500"
          href="/dashboard/billing"
        />
        <StatCard
          icon={Clock}
          label="Last Edit"
          value={
            lastActivity ? formatDistanceToNow(lastActivity) + " ago" : "Never"
          }
          state={sitesState}
          color="from-green-500 to-emerald-500"
          href="/dashboard/analytics"
          valueClassName="text-lg"
        />
      </div>

      {/* Sites Section — isolated so a failure here keeps the rest of the
          dashboard usable, which a route-level error.tsx cannot do. */}
      <ErrorBoundary level="section">
        <Card className="border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Your Sites</CardTitle>
                <CardDescription>
                  Manage your connected websites
                </CardDescription>
              </div>
              <Button
                className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
                onClick={() => setIsModalOpen(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add New Site
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {sitesState === "loading" && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <span className="sr-only">Loading sites…</span>
              </div>
            )}

            {sitesState === "error" && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-6">
                <div className="flex items-center space-x-3 text-red-800">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">Error loading sites</p>
                    <p className="text-sm">{sitesError}</p>
                  </div>
                </div>
                <Button
                  onClick={() => void fetchSites()}
                  variant="outline"
                  className="mt-4"
                >
                  Retry
                </Button>
              </div>
            )}

            {sitesState === "ready" && sites.length === 0 && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <Globe className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  No sites yet
                </h3>
                <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                  Add your first site to start making your content editable with
                  AI assistance.
                </p>
                <Button variant="outline" onClick={() => setIsModalOpen(true)}>
                  Get Started
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}

            {sitesState === "ready" && sites.length > 0 && (
              <div className="space-y-3">
                {recentSites.map((site) => {
                  const editsCount = site.stats?.edits_count ?? 0;
                  const siteLastActivity = site.stats?.last_activity;

                  return (
                    <Link
                      key={site.id}
                      href="/dashboard/sites"
                      className="block"
                    >
                      <div className="flex items-center gap-4 p-4 rounded-lg border border-border hover:shadow-md transition-shadow">
                        <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary/70 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Globe className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-foreground truncate">
                              {site.name}
                            </p>
                            {site.status && (
                              <Badge
                                variant={statusBadgeVariant[site.status]}
                                className="flex-shrink-0"
                              >
                                {statusLabel[site.status]}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {site.domain}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0 hidden sm:block">
                          <p className="text-sm font-medium text-foreground">
                            {editsCount} {editsCount === 1 ? "edit" : "edits"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {siteLastActivity
                              ? `${formatDistanceToNow(new Date(siteLastActivity))} ago`
                              : "No edits yet"}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}

                <div className="pt-2 text-center">
                  <Link href="/dashboard/sites">
                    <Button variant="outline">
                      {sites.length > RECENT_SITES_LIMIT
                        ? `View all ${sites.length} sites`
                        : "Manage sites"}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </ErrorBoundary>

      {/* Quick Actions - Navigate to different sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Link href="/dashboard/sites">
          <Card className="border-border hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center mb-4">
                <Globe className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">
                Manage Sites
              </h3>
              <p className="text-sm text-muted-foreground">
                View and configure your registered websites.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/content">
          <Card className="border-border hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center mb-4">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">
                Content Library
              </h3>
              <p className="text-sm text-muted-foreground">
                Browse and edit your site content.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/analytics">
          <Card className="border-border hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl flex items-center justify-center mb-4">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">
                View Analytics
              </h3>
              <p className="text-sm text-muted-foreground">
                Monitor performance and engagement.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/settings">
          <Card className="border-border hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl flex items-center justify-center mb-4">
                <SettingsIcon className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Settings</h3>
              <p className="text-sm text-muted-foreground">
                Customize your account preferences.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <SiteRegistrationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleSiteRegistrationSuccess}
      />
    </div>
  );
}
