"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { SiteRegistrationModal } from "@/components/dashboard/SiteRegistrationModal";
import { TrialStatusBadge } from "@/components/dashboard/TrialStatusBadge";
import { QuickSetup } from "@/components/dashboard/QuickSetup";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { Metric, type MetricState } from "@/components/ui/metric";
import { SectionHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { SkeletonList } from "@/components/ui/skeleton";
import {
  StatusBadge,
  resolveSiteStatus,
  type SiteStatus,
} from "@/components/ui/status-badge";
import {
  AlertCircle,
  ArrowRight,
  Clock,
  Globe,
  History,
  Plus,
  Zap,
} from "lucide-react";

const RECENT_SITES_LIMIT = 5;

/** Shape actually returned by `GET /api/sites` (not the full `Site` row). */
interface DashboardSite {
  id: string;
  name: string;
  domain: string;
  created_at: string;
  updated_at: string;
  status?: SiteStatus;
  embedScript?: string;
  siteToken?: string;
  stats?: {
    edits_count?: number;
    content_elements_count?: number;
    last_activity?: string | null;
  };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [sites, setSites] = useState<DashboardSite[]>([]);
  const [sitesState, setSitesState] = useState<MetricState>("loading");
  const [sitesError, setSitesError] = useState<string | null>(null);

  // AI usage lives in the billing tracker, not in /api/sites.
  const [aiSuggestions, setAiSuggestions] = useState<number | null>(null);
  const [aiState, setAiState] = useState<MetricState>("loading");

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

  /**
   * The lead metric used to be "Active sites", which counted only sites the
   * API flagged `active` — and that flag meant "we hold content for this site",
   * nothing more. An owner with two working, script-installed sites read
   * "Active sites 0" as the first and largest number on the page.
   *
   * The number that leads is now the one that is unambiguously true — how many
   * sites are connected — with the content figure demoted to its hint, where it
   * cannot be mistaken for a health verdict.
   *
   * `stale` counts here as well as `live`: both mean the script has reported at
   * least once, which is exactly what this hint claims. Only `awaiting-install`
   * has never been heard from. Counting `live` alone would have made a quiet
   * site disappear from a figure about its past, not its present.
   */
  const sitesWithContentCount = useMemo(
    () =>
      sites.filter((site) => site.status === "live" || site.status === "stale")
        .length,
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

  const installableSites = useMemo(
    () =>
      sites.filter(
        (site): site is DashboardSite & { embedScript: string } =>
          typeof site.embedScript === "string" &&
          site.embedScript.length > 0 &&
          typeof site.siteToken === "string",
      ),
    [sites],
  );

  // Fires when the site row exists, not when the dialog closes, so the summary
  // behind the success screen is already right. The modal closes itself.
  const handleSiteRegistrationSuccess = () => {
    void fetchSites();
  };

  const firstName = user?.user_metadata?.name?.split(" ")[0];

  return (
    <PageShell
      eyebrow="Overview"
      title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      description="Every site you have connected, and what has changed on them."
      actions={
        <>
          {/* Absent unless a trial is actually running, so nothing moves for
              anyone else. Renders itself from /api/billing/entitlement. */}
          <TrialStatusBadge />
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus aria-hidden="true" />
            Add site
          </Button>
        </>
      }
    >
      {/* One row per admin site whose quick setup is unfinished, each
          leading to that site's Overview, where the steps are (s66c2 AC 3).
          This used to stack a whole checklist per admin site above the
          summary. Each row decides for itself whether it is unfinished, so
          the list can end up empty: it is then not drawn, because an empty
          child of the shell is still a flex item and the shell's gap would
          be drawn twice above the summary (s66b1 review m-6). */}
      {sitesState === "ready" && user && installableSites.length > 0 && (
        <ul
          aria-label="Quick setup"
          className="divide-y divide-border rounded-container border border-border bg-card empty:hidden"
        >
          {installableSites.map((site) => (
            <QuickSetup
              key={`${user.id}:${site.id}`}
              variant="summary"
              site={site}
              userId={user.id}
            />
          ))}
        </ul>
      )}

      {/* Asymmetric by design. One number leads — how many sites are actually
          live — and the rest are subordinate to it. The previous four equal
          cards in a row gave a count, a total, a usage figure and a timestamp
          identical visual weight, which is a grid, not a hierarchy.
          At ≥1024 the lead takes the left third and spans three rows, and the
          three subordinates take the other two thirds. They used to sit in
          the middle column only (`lg:col-start-2`), which left the right third
          of the page empty (s66b2). */}
      <section aria-label="Summary" className="grid gap-3 lg:grid-cols-3">
        <Metric
          label="Connected sites"
          value={String(sites.length)}
          state={sitesState}
          icon={Globe}
          emphasis="lead"
          href="/dashboard/sites"
          hint={
            sites.length === 0
              ? undefined
              : sitesWithContentCount === 0
                ? "None have sent content yet"
                : `${sitesWithContentCount} of ${sites.length} have sent content`
          }
          className="lg:row-span-3"
        />
        <Metric
          label="Total edits"
          value={String(totalEdits)}
          state={sitesState}
          icon={History}
          href="/dashboard/content"
          className="lg:col-span-2"
        />
        <Metric
          label="AI suggestions"
          value={aiSuggestions === null ? null : String(aiSuggestions)}
          state={aiState}
          icon={Zap}
          hint="Last 30 days"
          href="/dashboard/billing"
          className="lg:col-span-2"
        />
        <Metric
          label="Last edit"
          value={
            lastActivity ? `${formatDistanceToNow(lastActivity)} ago` : "Never"
          }
          state={sitesState}
          icon={Clock}
          href="/dashboard/analytics"
          className="lg:col-span-2"
        />
      </section>

      {/* Isolated so a failure here keeps the rest of the dashboard usable,
          which a route-level error.tsx cannot do. */}
      <ErrorBoundary level="section">
        <Card variant="outline">
          <CardContent className="p-0">
            <div className="border-b border-border px-6 py-5">
              <SectionHeader
                title="Your sites"
                description="Most recently connected first."
                actions={
                  sites.length > 0 ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/dashboard/sites">
                        {sites.length > RECENT_SITES_LIMIT
                          ? `All ${sites.length}`
                          : "Manage"}
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
            </div>

            {sitesState !== "ready" || sites.length === 0 ? (
              <div className="px-6 py-5">
                {sitesState === "loading" && (
                  <SkeletonList rows={3} label="Loading sites" />
                )}

                {sitesState === "error" && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    <AlertTitle>Could not load your sites</AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>{sitesError}</p>
                      <Button
                        onClick={() => void fetchSites()}
                        variant="outline"
                        size="sm"
                      >
                        Try again
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {sitesState === "ready" && sites.length === 0 && (
                  <EmptyState
                    icon={Globe}
                    title="No sites connected yet"
                    description="ReCopyFast makes an existing site editable. Connect one to start."
                    action={
                      <Button onClick={() => setIsModalOpen(true)}>
                        <Plus aria-hidden="true" />
                        Add your first site
                      </Button>
                    }
                    steps={[
                      "Register the domain you want to make editable.",
                      "Paste the one-line script tag into that site's HTML.",
                      "Open your site and edit any text in place — changes appear here.",
                    ]}
                  />
                )}
              </div>
            ) : (
              // Full-bleed divided rows in the one panel: no box inside the
              // box, and no lift. Each row was its own bordered card with
              // `.surface-interactive`, which rose 1px with a shadow on hover
              // (s66b2; design system, Surfaces and elevation).
              <ul className="divide-y divide-border">
                {recentSites.map((site) => {
                  const editsCount = site.stats?.edits_count ?? 0;
                  const siteLastActivity = site.stats?.last_activity;

                  return (
                    <li key={site.id}>
                      <Link
                        href={`/dashboard/sites/${site.id}`}
                        className="flex items-center gap-3 px-6 py-3.5 transition-colors duration-200 ease-out hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <IconTile>
                          <Globe aria-hidden="true" />
                        </IconTile>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-foreground">
                              {site.name}
                            </p>
                            {site.status && (
                              <StatusBadge
                                status={resolveSiteStatus(site.status)}
                                hideIcon
                                size="sm"
                                className="shrink-0"
                              />
                            )}
                          </div>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {site.domain}
                          </p>
                        </div>

                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="tabular text-sm text-foreground">
                            {editsCount} {editsCount === 1 ? "edit" : "edits"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {siteLastActivity
                              ? `${formatDistanceToNow(new Date(siteLastActivity))} ago`
                              : "No edits yet"}
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </ErrorBoundary>

      <SiteRegistrationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleSiteRegistrationSuccess}
      />
    </PageShell>
  );
}
