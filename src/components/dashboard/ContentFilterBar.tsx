"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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

  // A wrapping row on the page's left edge (design system, Shell: "Filter
  // row"). Search takes what is left and never shrinks below 12rem; the
  // selects wrap under it rather than squeezing it. Below 640 each select
  // takes the full row (s66b design §4): at its content width it left a
  // ragged right edge that lined up with nothing (s66b1 review m-7).
  return (
    <div className="flex flex-wrap gap-2">
      {/* Search */}
      <div className="relative min-w-[12rem] flex-1">
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
      <div className="w-full sm:w-auto md:min-w-[150px]">
        <label htmlFor={siteId} className="sr-only">
          Filter by site
        </label>
        <NativeSelect
          id={siteId}
          value={selectedSiteId || ""}
          onChange={(e) => onSiteChange(e.target.value || null)}
        >
          <option value="">All Sites</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name || site.domain}
            </option>
          ))}
        </NativeSelect>
      </div>

      {/* Status Filter */}
      <div className="w-full sm:w-auto md:min-w-[120px]">
        <label htmlFor={statusId} className="sr-only">
          Filter by status
        </label>
        <NativeSelect
          id={statusId}
          value={selectedStatus}
          onChange={(e) =>
            onStatusChange(e.target.value as ContentStatusFilter)
          }
        >
          <option value="all">All Status</option>
          <option value="original">Original</option>
          <option value="edited">Edited</option>
          <option value="pending">Pending</option>
        </NativeSelect>
      </div>
    </div>
  );
}
