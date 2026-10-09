"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, FileText, Globe, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useChangeActions,
  type ActionOutcome,
  type ChangeAction,
} from "@/hooks/useChangeActions";
import {
  useContentChanges,
  type ChangesPage,
  type ChangesSite,
  type ChangesStateFilter,
  type ContentChange,
} from "@/hooks/useContentChanges";
import { CHANGES_LIST_CEILING } from "@/lib/content/changes-paging";
import { describePage } from "@/lib/content/describe-location";
import { ChangeSiteGroup, type PageGroup } from "./ChangeSiteGroup";
import { ChangesFilterBar } from "./ChangesFilterBar";
import { rowAfter } from "./row-after";

interface ChangesViewProps {
  /** Fixes the view to one site (s70c's tab): no site select, no site header. */
  siteId?: string;
}

const ANNOUNCEMENTS: Record<ChangeAction, string> = {
  revertToDraft: "Reverted. Saved as a draft.",
  revertAndPublish: "Reverted and published.",
  discardDraft: "Draft discarded.",
  publish: "Published.",
};

const NO_ROWS_TITLE: Record<ChangesStateFilter, string> = {
  changes: "No changes yet.",
  pending: "No pending changes.",
  published: "No published changes.",
  all: "No text recorded yet.",
};

const count = (value: number) => value.toLocaleString("en-US");
const plural = (value: number, one: string, many: string) =>
  `${count(value)} ${value === 1 ? one : many}`;

interface SiteGroup {
  site: ChangesSite;
  pages: PageGroup[];
}

/**
 * Site → page, in the order rows arrive (newest change first): a site's panel
 * sits where its newest change is, and a page's band where its newest is. A
 * page loaded by "Show 50 more" joins its existing band.
 */
function groupRows(page: ChangesPage): SiteGroup[] {
  const sitesById = new Map(page.sites.map((site) => [site.id, site]));
  const groups: SiteGroup[] = [];
  for (const row of page.rows) {
    const site = sitesById.get(row.siteId);
    if (!site) continue;
    let group = groups.find((candidate) => candidate.site.id === site.id);
    if (!group) {
      group = { site, pages: [] };
      groups.push(group);
    }
    let band = group.pages.find(
      (candidate) => candidate.pagePath === row.pagePath,
    );
    if (!band) {
      band = {
        pagePath: row.pagePath,
        label: describePage(row.pagePath),
        rows: [],
      };
      group.pages.push(band);
    }
    band.rows.push(row);
  }
  return groups;
}

/**
 * "on 2 sites": the sites the list holds, once all of it is loaded. With more
 * rows to come a site further down is not known yet, so no count is given.
 * Tombstone (s70b review m5): this counted every site the caller has, so one
 * changed site out of three read "2 changes on 3 sites".
 */
function sitesWithChanges(data: ChangesPage): string | null {
  if (data.nextOffset !== null) return null;
  const siteIds = new Set(data.rows.map((row) => row.siteId));
  return siteIds.size > 0 ? plural(siteIds.size, "site", "sites") : null;
}

function resultLine(
  data: ChangesPage,
  state: ChangesStateFilter,
  query: string,
  siteName: string | null,
): string {
  if (state === "all") {
    return `Showing ${count(data.rows.length)} of ${plural(data.total, "text element", "text elements")}`;
  }
  if (query && data.total === 0) return `0 changes match “${query}”`;
  const where = siteName ?? sitesWithChanges(data);
  const on = where ? ` on ${where}` : "";
  if (state === "pending") return `${count(data.total)} pending${on}`;
  if (state === "published") return `${count(data.total)} published${on}`;
  return `${plural(data.total, "change", "changes")}${on}`;
}

function LoadingPanel({ showHeader }: { showHeader: boolean }) {
  return (
    <Card
      role="status"
      aria-label="Loading changes"
      className="overflow-hidden"
    >
      {showHeader && (
        <div className="flex h-12 items-center gap-3 border-b border-border px-4">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-2.5 w-28" />
        </div>
      )}
      <div className="flex h-9 items-center border-b border-border bg-surface-1 px-4">
        <Skeleton className="h-3 w-24" />
      </div>
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="flex h-11 items-center gap-3 border-b border-border px-4 last:border-b-0"
        >
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="hidden h-3 w-1/3 md:block" />
        </div>
      ))}
    </Card>
  );
}

/**
 * The Changes view (s70b): what changed on the owner's sites, grouped site →
 * page, 50 rows at a time from GET /api/content/changes. Used by
 * /dashboard/changes and, with `siteId`, by a site's Content tab (s70c).
 *
 * Every state is its own component (design system, States): a skeleton while
 * loading, an empty state that says why, and an error that is never drawn as
 * an empty list — the old Content page's refused read rendered "No content
 * found", which reads as "your account is empty" (`useSites.ts`).
 */
export function ChangesView({ siteId }: ChangesViewProps) {
  const [query, setQuery] = useState("");
  const [pickedSite, setPickedSite] = useState<string | null>(null);
  const [state, setState] = useState<ChangesStateFilter>("changes");
  const [announcement, setAnnouncement] = useState("");
  const site = siteId ?? pickedSite;
  const {
    data,
    sites,
    counts,
    loading,
    error,
    refetch,
    loadMore,
    isLoadingMore,
    updateRow,
    appliedQuery,
  } = useContentChanges({ site, state, q: query });
  const actions = useChangeActions();

  const filtersChanged =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setAnnouncement("");
      set(value);
    };

  // The row is redrawn from what landed, not from what was asked: a revert
  // whose publish failed is a pending draft, and is drawn as one.
  const runAction = async (
    row: ContentChange,
    action: ChangeAction,
  ): Promise<ActionOutcome> => {
    const outcome = await actions[action](row);
    if (outcome.applied) {
      updateRow(row.id, rowAfter(row, outcome.applied));
      setAnnouncement(outcome.error ? "" : ANNOUNCEMENTS[action]);
    }
    return outcome;
  };

  const clearSearch = () => {
    setAnnouncement("");
    setQuery("");
  };
  const showAllText = () => {
    setAnnouncement("");
    setState("all");
  };
  const siteName = site
    ? (sites?.find((candidate) => candidate.id === site)?.name ?? null)
    : null;
  // More rows match than "Show 50 more" can reach (changes-paging.ts): say so
  // rather than end the list as if it were complete.
  const isCapped =
    data !== null &&
    data.nextOffset === null &&
    data.total > CHANGES_LIST_CEILING;

  const renderBody = () => {
    if (!data && error) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-2">
            <p className="font-medium">Changes could not be loaded.</p>
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    if (!data) return <LoadingPanel showHeader={!siteId} />;

    if (!siteId && data.sites.length === 0) {
      return (
        <Card>
          <EmptyState
            icon={Globe}
            title="Add a site to see its changes here."
            description="Install the snippet on a site and every change made to its text is listed on this page."
            action={
              <Link
                href="/dashboard/sites"
                className={buttonVariants({ size: "sm" })}
              >
                Add site
              </Link>
            }
          />
        </Card>
      );
    }

    if (data.rows.length === 0) {
      if (appliedQuery) {
        return (
          <Card className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <p className="text-sm text-foreground">
              Nothing matches “{appliedQuery}”.
            </p>
            <Button variant="ghost" size="sm" onClick={clearSearch}>
              Clear search
            </Button>
          </Card>
        );
      }
      return (
        <Card>
          <EmptyState
            icon={FileText}
            title={NO_ROWS_TITLE[state]}
            description="Text you or your editors change shows up here, grouped by page."
            action={
              state === "all" ? undefined : (
                <Button variant="outline" size="sm" onClick={showAllText}>
                  Show all text
                </Button>
              )
            }
          />
        </Card>
      );
    }

    return groupRows(data).map((group) => (
      <ChangeSiteGroup
        key={group.site.id}
        site={group.site}
        pages={group.pages}
        showHeader={!siteId}
        busy={actions.pendingAction}
        onAction={runAction}
      />
    ));
  };

  return (
    <>
      {/* Sites and counts come from the hook's frame, which outlives a
          reload: drawn from the reloading `data`, the site select unmounted
          under the owner's hand on every pick (s70b review M1). */}
      <ChangesFilterBar
        query={query}
        onQueryChange={filtersChanged(setQuery)}
        sites={siteId ? undefined : (sites ?? undefined)}
        siteId={pickedSite}
        onSiteChange={filtersChanged(setPickedSite)}
        state={state}
        onStateChange={filtersChanged(setState)}
        counts={counts}
      />

      {(data || loading) && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {data
            ? resultLine(data, state, appliedQuery, siteName)
            : "Loading changes…"}
          {announcement && (
            <>
              {" · "}
              <span className="text-foreground">{announcement}</span>
            </>
          )}
        </p>
      )}

      {renderBody()}

      {data && (data.nextOffset !== null || isCapped || error) && (
        <div className="flex flex-wrap items-center gap-3">
          {data.nextOffset !== null && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
              >
                {isLoadingMore && (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                )}
                Show 50 more
              </Button>
              <span className="tabular text-xs text-muted-foreground">
                Showing {count(data.rows.length)} of {count(data.total)}
              </span>
            </>
          )}
          {isCapped && (
            <span className="tabular text-xs text-muted-foreground">
              Showing the first {count(data.rows.length)} of {count(data.total)}{" "}
              — use the filters or search to see more.
            </span>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </>
  );
}
