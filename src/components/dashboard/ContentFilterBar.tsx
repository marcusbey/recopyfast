"use client";

import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface Site {
  id: string;
  name: string;
  domain: string;
}

interface ContentFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedSiteId: string | null;
  onSiteChange: (siteId: string | null) => void;
  selectedStatus: "all" | "original" | "edited" | "pending";
  onStatusChange: (status: "all" | "original" | "edited" | "pending") => void;
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
  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* Search */}
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <Input
          placeholder="Search content..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Site Filter */}
      <select
        value={selectedSiteId || ""}
        onChange={(e) => onSiteChange(e.target.value || null)}
        className="h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]"
      >
        <option value="">All Sites</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name || site.domain}
          </option>
        ))}
      </select>

      {/* Status Filter */}
      <select
        value={selectedStatus}
        onChange={(e) =>
          onStatusChange(
            e.target.value as "all" | "original" | "edited" | "pending",
          )
        }
        className="h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[120px]"
      >
        <option value="all">All Status</option>
        <option value="original">Original</option>
        <option value="edited">Edited</option>
        <option value="pending">Pending</option>
      </select>
    </div>
  );
}
