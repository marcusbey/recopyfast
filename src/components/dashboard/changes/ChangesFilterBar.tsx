"use client";

import { useId } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type {
  ChangesCounts,
  ChangesSite,
  ChangesStateFilter,
} from "@/hooks/useContentChanges";

interface ChangesFilterBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Absent when the view is fixed to one site (s70c's tab). */
  sites?: ChangesSite[];
  siteId: string | null;
  onSiteChange: (siteId: string | null) => void;
  state: ChangesStateFilter;
  onStateChange: (state: ChangesStateFilter) => void;
  /**
   * The server's counts for the last answered site and search: kept while the
   * list reloads, null only before the first answer.
   */
  counts: ChangesCounts | null;
}

const formatCount = (value: number) => value.toLocaleString("en-US");

/**
 * The Changes page's filter row, which replaces the Content page's
 * `ContentFilterBar` and keeps its layout: a wrapping row on the page's left
 * edge (design system, Shell: "Filter row"), search taking what is left and
 * never shrinking below 12rem, the selects wrapping under it rather than
 * squeezing it. Below 640 each select takes the full row (s66b design §4): at
 * its content width it left a ragged right edge that lined up with nothing
 * (s66b1 review m-7).
 *
 * Search is server-side (the hook debounces it): it reads the original, live
 * and draft text and the page path. The status counts come from the server
 * with the same site and search, so "Pending (3)" is what the list will hold.
 */
export function ChangesFilterBar({
  query,
  onQueryChange,
  sites,
  siteId,
  onSiteChange,
  state,
  onStateChange,
  counts,
}: ChangesFilterBarProps) {
  const searchId = useId();
  const siteSelectId = useId();
  const statusId = useId();

  const label = (name: string, value: number | undefined) =>
    counts && value !== undefined ? `${name} (${formatCount(value)})` : name;
  const changes = counts ? counts.pending + counts.published : undefined;
  const all = counts
    ? counts.pending + counts.published + counts.original
    : undefined;

  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-[12rem] flex-1">
        <label htmlFor={searchId} className="sr-only">
          Search text or page
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={searchId}
          type="search"
          placeholder="Search text or page"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="pl-10"
        />
      </div>

      {sites && (
        <div className="w-full sm:w-auto md:min-w-[150px]">
          <label htmlFor={siteSelectId} className="sr-only">
            Filter by site
          </label>
          <NativeSelect
            id={siteSelectId}
            value={siteId ?? ""}
            onChange={(event) => onSiteChange(event.target.value || null)}
          >
            <option value="">All sites</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      <div className="w-full sm:w-auto md:min-w-[150px]">
        <label htmlFor={statusId} className="sr-only">
          Filter by status
        </label>
        <NativeSelect
          id={statusId}
          value={state}
          onChange={(event) =>
            onStateChange(event.target.value as ChangesStateFilter)
          }
        >
          <option value="changes">{label("Changes", changes)}</option>
          <option value="pending">{label("Pending", counts?.pending)}</option>
          <option value="published">
            {label("Published", counts?.published)}
          </option>
          <option value="all">{label("All text", all)}</option>
        </NativeSelect>
      </div>
    </div>
  );
}
