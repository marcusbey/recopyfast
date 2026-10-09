"use client";

import { useId } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge, contentStatuses } from "@/components/ui/status-badge";
import type { ChangeAction } from "@/hooks/useChangeActions";
import type { ChangesSite, ContentChange } from "@/hooks/useContentChanges";
import { cn } from "@/lib/utils/cn";
import { ChangeRow } from "./ChangeRow";

export interface PageGroup {
  /** `page_path`, or null for rows shared by every page. */
  pagePath: string | null;
  label: string;
  rows: ContentChange[];
}

interface ChangeSiteGroupProps {
  site: ChangesSite;
  pages: PageGroup[];
  /** False on a site's own tab (s70c): the frame already names the site. */
  showHeader: boolean;
  busy: { rowId: string; action: ChangeAction } | null;
  onAction: (
    row: ContentChange,
    action: ChangeAction,
  ) => Promise<string | null>;
}

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/**
 * One panel per site (design, "Global page" 3): a header naming the site and
 * counting its loaded changes, then a band per page with its rows. Headings
 * nest under the page's one h1: the site is an h2, the page an h3.
 */
export function ChangeSiteGroup({
  site,
  pages,
  showHeader,
  busy,
  onAction,
}: ChangeSiteGroupProps) {
  const headingId = useId();
  const rows = pages.flatMap((page) => page.rows);
  const pending = rows.filter((row) => row.state === "pending").length;
  const published = rows.filter((row) => row.state === "published").length;

  return (
    <Card
      role="region"
      aria-labelledby={showHeader ? headingId : undefined}
      aria-label={showHeader ? undefined : site.name}
      className="min-w-0 overflow-hidden"
    >
      {showHeader && (
        <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2">
          <h2
            id={headingId}
            className="min-w-0 truncate text-sm font-semibold text-foreground"
          >
            {site.name}
          </h2>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {site.domain}
          </span>
          <span className="flex flex-wrap gap-1.5">
            {pending > 0 && (
              <StatusBadge
                hideIcon
                status={{
                  ...contentStatuses.pending,
                  label: `${pending.toLocaleString("en-US")} pending`,
                }}
              />
            )}
            {published > 0 && (
              <StatusBadge
                hideIcon
                status={{
                  ...contentStatuses.published,
                  label: `${published.toLocaleString("en-US")} published`,
                }}
              />
            )}
          </span>
          {/* `buttonVariants` on the Link: `<Button asChild>` drops every
              class (Button's Fragment child is what Slot clones). */}
          <Link
            href={`/dashboard/sites/${site.id}`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "ml-auto",
            )}
          >
            Site page
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      )}

      {pages.map((page, index) => (
        <div
          key={page.pagePath ?? "\u0000shared"}
          className={index > 0 ? "border-t border-border" : undefined}
        >
          <div className="flex min-h-9 items-center gap-x-3 border-b border-border bg-surface-1 px-4 py-1.5">
            {/* The label keeps its words; the path or the note gives way
                first (at 375 "Every page" was cut to "Every …"). */}
            <h3 className="max-w-[60%] shrink-0 truncate text-sm font-medium text-foreground">
              {page.label}
            </h3>
            {page.pagePath === null ? (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                Shared by every page (set with data-rcf-id)
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {page.pagePath}
              </span>
            )}
            <span className="tabular shrink-0 text-xs text-muted-foreground">
              {plural(page.rows.length, "change", "changes")}
            </span>
          </div>
          <ul>
            {page.rows.map((row) => (
              <ChangeRow
                key={row.id}
                row={row}
                site={site}
                pageLabel={page.label}
                busyAction={busy?.rowId === row.id ? busy.action : null}
                onAction={onAction}
              />
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}
