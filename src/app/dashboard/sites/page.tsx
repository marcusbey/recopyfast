"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { DeleteSiteDialog } from "@/components/dashboard/DeleteSiteDialog";
import { ShareSiteDialog } from "@/components/dashboard/ShareSiteDialog";
import { SiteRegistrationModal } from "@/components/dashboard/SiteRegistrationModal";
import { SiteRow } from "@/components/dashboard/SiteRow";
import type { SiteRecord } from "@/components/dashboard/site/SiteProvider";
import { sitePageHref } from "@/components/dashboard/site/SiteSubnav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import type { SiteStatus } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils/cn";
import {
  Globe,
  Plus,
  Search,
  SearchX,
  ArrowUpDown,
  AlertCircle,
  X,
} from "lucide-react";

type SortOption = "name" | "date" | "activity";
type FilterOption = "all" | SiteStatus;

/* The filters follow the site state machine, one for one. They used to read
   Active / No content yet / Inactive — three words for one recomputed
   `content_elements` count, one of which ("Verifying") named a check nothing in
   this product performs. See `siteStatuses` in `@/components/ui/status-badge`
   and docs/decisions/006-site-status-persisted-state-machine.md. */
const STATUS_FILTERS: ReadonlyArray<{ value: FilterOption; label: string }> = [
  { value: "all", label: "All" },
  { value: "awaiting-install", label: "Awaiting install" },
  { value: "live", label: "Live" },
  { value: "stale", label: "Stale" },
];

const SORT_LABELS: Record<SortOption, string> = {
  name: "Name",
  date: "Date added",
  activity: "Last activity",
};

/**
 * Set by the redirect that retired `/dashboard/teams`. It is the only thing
 * telling an owner who asked for team management why they are looking at a list
 * of sites instead — see `src/app/dashboard/teams/page.tsx`.
 */
const TEAMS_MOVED_NOTICE = "teams-moved";

/**
 * Sites: a light list, one row per site (s66c1 AC 3).
 *
 * Until s66c1 this page also was each site's detail view: "View Details"
 * swapped it, in component state, for an 11-card page about 4,400 px tall,
 * with no URL — Back left the dashboard, and nothing could link to a site. A
 * site now has its own pages under `/dashboard/sites/<id>` (ADR 052), so this
 * page lists, filters, and hands off. It no longer polls either: the install
 * poll moved with the site to `SiteProvider`.
 */
export default function SitesPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("date");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");

  // Modal state
  const [isRegistrationModalOpen, setIsRegistrationModalOpen] = useState(false);

  // Session-local only, and deliberately so: the notice is triggered by a query
  // param the user can only arrive with once per navigation, so there is
  // nothing worth persisting and nothing to clean up if they never dismiss it.
  const [isTeamsNoticeDismissed, setIsTeamsNoticeDismissed] = useState(false);

  // The row menu's two dialogs, each for one site at a time.
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [shareTargetId, setShareTargetId] = useState<string | null>(null);

  // Fetch sites
  const fetchSites = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/sites");

      if (!response.ok) {
        throw new Error("Failed to fetch sites");
      }

      const data = await response.json();
      setSites(data.sites || []);
    } catch (err) {
      console.error("Error fetching sites:", err);
      setError(err instanceof Error ? err.message : "Failed to load sites");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchSites();
    }
  }, [user]);

  // Filter and sort sites
  const filteredAndSortedSites = useMemo(() => {
    let result = [...sites];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (site) =>
          site.name.toLowerCase().includes(query) ||
          site.domain.toLowerCase().includes(query),
      );
    }

    // Apply status filter
    if (filterBy !== "all") {
      result = result.filter((site) => site.status === filterBy);
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "date":
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        case "activity": {
          const aActivity = a.stats?.last_activity
            ? new Date(a.stats.last_activity).getTime()
            : 0;
          const bActivity = b.stats?.last_activity
            ? new Date(b.stats.last_activity).getTime()
            : 0;
          return bActivity - aActivity;
        }
        default:
          return 0;
      }
    });

    return result;
  }, [sites, searchQuery, sortBy, filterBy]);

  const deleteTarget = sites.find((site) => site.id === deleteTargetId) ?? null;
  const shareTarget = sites.find((site) => site.id === shareTargetId) ?? null;

  const handleDeleted = (siteId: string) => {
    setSites((prev) => prev.filter((site) => site.id !== siteId));
    setDeleteTargetId(null);
  };

  /**
   * Fired the moment the site row exists, not when the dialog is dismissed.
   *
   * The modal used to report success only from its "Go to Site Dashboard"
   * button, so the list and the counts behind the open dialog still said "no
   * sites connected" while the success screen was on top of them, and pressing
   * Close left them wrong until a manual reload.
   */
  const handleRegistrationSuccess = () => {
    void fetchSites();
  };

  const isTeamsMovedNoticeVisible =
    !isTeamsNoticeDismissed &&
    searchParams.get("notice") === TEAMS_MOVED_NOTICE;

  const statusCounts = useMemo(() => {
    return {
      all: sites.length,
      "awaiting-install": sites.filter((s) => s.status === "awaiting-install")
        .length,
      live: sites.filter((s) => s.status === "live").length,
      stale: sites.filter((s) => s.status === "stale").length,
    };
  }, [sites]);

  return (
    <PageShell
      title="Sites"
      description="Every domain you have connected to ReCopyFast."
      actions={
        <Button onClick={() => setIsRegistrationModalOpen(true)}>
          <Plus aria-hidden="true" />
          Add site
        </Button>
      }
    >
      {/* Driven by the query param alone, so it needs no fetch and renders in
          every state of the list below — including the empty one. An owner
          redirected off /dashboard/teams may have no sites at all and still
          needs to know why they are on this page. */}
      {isTeamsMovedNoticeVisible && (
        <Alert variant="info" className="flex items-start gap-3">
          <div className="flex-1">
            <AlertTitle>Team management has moved</AlertTitle>
            <AlertDescription>
              Invite people to edit a site from that site&apos;s People &amp;
              access page — open a site below and choose People &amp; access.
            </AlertDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            onClick={() => setIsTeamsNoticeDismissed(true)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Alert>
      )}

      {/* These were four metric cards. They never were metrics — clicking one
          filtered the list. Presented as a segmented filter they say what they
          actually do, and the counts still read at a glance. The filter wraps
          (design system, Shell: a filter never hides options behind a hidden
          scrollbar); at 375 it used to clip behind one. */}
      <div className="flex flex-wrap gap-2">
        <div
          className="flex flex-wrap items-center gap-1 rounded-container border border-border bg-surface-1 p-[3px]"
          role="group"
          aria-label="Filter sites by status"
        >
          {STATUS_FILTERS.map((option) => {
            const selected = filterBy === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilterBy(option.value)}
                aria-pressed={selected}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-2 rounded-control px-2.5 text-sm",
                  "transition-[color,background-color] duration-200 ease-out",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected
                    ? "bg-card font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
                <span
                  className={cn(
                    "tabular rounded-control px-1.5 py-0.5 text-[0.6875rem] font-semibold",
                    selected
                      ? "bg-surface-3 text-foreground"
                      : "bg-card/60 text-muted-foreground",
                  )}
                >
                  {statusCounts[option.value]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex min-w-[12rem] flex-1 gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Search by name or domain"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Search sites"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* The label is hidden below `sm`, and the icon is aria-hidden —
                  without an explicit name this button is unlabelled for screen
                  readers on mobile. */}
              <Button
                variant="outline"
                className="shrink-0"
                aria-label={`Sort sites (currently ${SORT_LABELS[sortBy].toLowerCase()})`}
              >
                <ArrowUpDown aria-hidden="true" />
                <span className="hidden sm:inline">{SORT_LABELS[sortBy]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setSortBy("name")}>
                Sort by name
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("date")}>
                Sort by date added
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("activity")}>
                Sort by last activity
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        // Rows, not a spinner: the list keeps its shape while it fills.
        <ul
          className="rounded-container border border-border bg-card"
          role="status"
          aria-label="Loading sites"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <li
              key={index}
              className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
            >
              <Skeleton className="h-9 w-9" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="hidden h-8 w-28 md:block" />
            </li>
          ))}
        </ul>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Could not load your sites</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error}</p>
            <Button onClick={fetchSites} variant="outline" size="sm">
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : filteredAndSortedSites.length === 0 ? (
        <Card variant="outline">
          <CardContent className="p-0">
            {searchQuery || filterBy !== "all" ? (
              <EmptyState
                icon={SearchX}
                title="Nothing matches those filters"
                description={
                  searchQuery
                    ? `No site matches “${searchQuery}”${filterBy === "all" ? "" : ` with status ${filterBy}`}.`
                    : `You have no ${filterBy} sites.`
                }
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchQuery("");
                      setFilterBy("all");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Globe}
                title="No sites connected yet"
                description="ReCopyFast turns a site you already have into one your team can edit in place."
                action={
                  <Button onClick={() => setIsRegistrationModalOpen(true)}>
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
          </CardContent>
        </Card>
      ) : (
        // One bordered panel of ruled rows: there is no Table primitive
        // (design-system gap 8).
        <ul className="divide-y divide-border rounded-container border border-border bg-card">
          {filteredAndSortedSites.map((site) => (
            <SiteRow
              key={site.id}
              site={site}
              onDelete={setDeleteTargetId}
              onShare={setShareTargetId}
            />
          ))}
        </ul>
      )}

      {/* Site Registration Modal */}
      <SiteRegistrationModal
        isOpen={isRegistrationModalOpen}
        onClose={() => setIsRegistrationModalOpen(false)}
        onSuccess={handleRegistrationSuccess}
      />

      <DeleteSiteDialog
        site={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null);
        }}
        onDeleted={handleDeleted}
      />

      {/* Create-only: the site's links are listed on its People & access
          page, which the success message links to. */}
      {shareTarget && (
        <ShareSiteDialog
          open
          onOpenChange={(open) => {
            if (!open) setShareTargetId(null);
          }}
          site={shareTarget}
          manageHref={sitePageHref(shareTarget.id, "people")}
        />
      )}
    </PageShell>
  );
}
