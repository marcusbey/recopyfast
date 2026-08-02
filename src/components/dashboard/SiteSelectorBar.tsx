"use client";

import { useId } from "react";

interface Site {
  id: string;
  name: string;
  domain: string;
}

interface SiteSelectorBarProps {
  sites: Site[];
  selectedSiteId: string;
  onSiteChange: (siteId: string) => void;
}

export function SiteSelectorBar({
  sites,
  selectedSiteId,
  onSiteChange,
}: SiteSelectorBarProps) {
  const selectId = useId();

  if (sites.length <= 1) return null;

  return (
    <div className="flex items-center gap-3">
      <label htmlFor={selectId} className="text-sm font-medium text-foreground">
        Site:
      </label>
      <select
        id={selectId}
        className="rounded-md border border-input px-3 py-1.5 text-sm"
        value={selectedSiteId}
        onChange={(e) => onSiteChange(e.target.value)}
      >
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name} ({site.domain})
          </option>
        ))}
      </select>
    </div>
  );
}
