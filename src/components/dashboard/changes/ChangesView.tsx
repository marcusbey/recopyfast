"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, FileText, Globe, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useChangeActions, type ChangeAction } from "@/hooks/useChangeActions";
import {
  useContentChanges,
  type ChangesPage,
  type ChangesSite,
  type ChangesStateFilter,
  type ContentChange,
} from "@/hooks/useContentChanges";
import { describePage } from "@/lib/content/describe-location";
import { ChangeSiteGroup, type PageGroup } from "./ChangeSiteGroup";
import { ChangesFilterBar } from "./ChangesFilterBar";

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

/**
 * What the row becomes after a write that succeeded, without a reload (design,
 * "success in place"). The server derives the state (ADR 054); this mirrors
 * its rules for the one row that changed. A discarded draft cannot know
 * `published_at`, so a row published back to its original reads Original here
 * until the next read says Published.
 */
function rowAfter(
  row: ContentChange,
  action: ChangeAction,
): Partial<ContentChange> {
  const changedAt = new Date().toISOString();
  switch (action) {
    case "revertToDraft":
      return {
        draft: row.original,
        state: row.original !== row.live ? "pending" : row.state,
        changedAt,
      };
    case "revertAndPublish":
      return { state: "published", live: row.original, draft: null, changedAt };
    case "discardDraft":
      return {
        state: row.live !== row.original ? "published" : "original",
        draft: null,
        changedAt,
      };
    case "publish":
      return {
        state: "published",
        live: row.draft ?? row.live,
        draft: null,
        changedAt,
      };
  }
}

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
  const where = siteName ?? plural(data.sites.length, "site", "sites");
  if (state === "pending") return `${count(data.total)} pending on ${where}`;
  if (state === "published") {
    return `${count(data.total)} published on ${where}`;
  }
  return `${plural(data.total, "change", "changes")} on ${where}`;
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

  const runAction = async (
    row: ContentChange,
    action: ChangeAction,
  ): Promise<string | null> => {
    const refused = await actions[action](row);
    if (refused) return refused;
    updateRow(row.id, rowAfter(row, action));
    setAnnouncement(ANNOUNCEMENTS[action]);
    return null;
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
    ? (data?.sites.find((candidate) => candidate.id === site)?.name ?? null)
    : null;

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
      <ChangesFilterBar
        query={query}
        onQueryChange={filtersChanged(setQuery)}
        sites={siteId ? undefined : data?.sites}
        siteId={pickedSite}
        onSiteChange={filtersChanged(setPickedSite)}
        state={state}
        onStateChange={filtersChanged(setState)}
        counts={data?.counts ?? null}
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

      {data && (data.nextOffset !== null || error) && (
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
