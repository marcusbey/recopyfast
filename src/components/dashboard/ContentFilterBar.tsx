"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface Site {
  id: string;
  name: string;
  domain: string;
}

type ContentStatusFilter = "all" | "original" | "edited" | "pending";

interface ContentFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedSiteId: string | null;
  onSiteChange: (siteId: string | null) => void;
  selectedStatus: ContentStatusFilter;
  onStatusChange: (status: ContentStatusFilter) => void;
  sites: Site[];
}

/** Matches the Input primitive so the row reads as one control group. */
const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:w-auto";

export function ContentFilterBar({
  searchQuery,
  onSearchChange,
  selectedSiteId,
  onSiteChange,
  selectedStatus,
  onStatusChange,
  sites,
}: ContentFilterBarProps) {
  const searchId = useId();
  const siteId = useId();
  const statusId = useId();

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      {/* Search */}
      <div className="relative flex-1">
        <label htmlFor={searchId} className="sr-only">
          Search content
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={searchId}
          type="search"
          placeholder="Search content..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Site Filter */}
      <div className="md:min-w-[150px]">
        <label htmlFor={siteId} className="sr-only">
          Filter by site
        </label>
        <select
          id={siteId}
          value={selectedSiteId || ""}
          onChange={(e) => onSiteChange(e.target.value || null)}
          className={selectClassName}
        >
          <option value="">All Sites</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name || site.domain}
            </option>
          ))}
        </select>
      </div>

      {/* Status Filter */}
      <div className="md:min-w-[120px]">
        <label htmlFor={statusId} className="sr-only">
          Filter by status
        </label>
        <select
          id={statusId}
          value={selectedStatus}
          onChange={(e) =>
            onStatusChange(e.target.value as ContentStatusFilter)
          }
          className={selectClassName}
        >
          <option value="all">All Status</option>
          <option value="original">Original</option>
          <option value="edited">Edited</option>
          <option value="pending">Pending</option>
        </select>
      </div>
    </div>
  );
}
