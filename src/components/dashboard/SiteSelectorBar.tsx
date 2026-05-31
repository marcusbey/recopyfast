"use client";

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
  if (sites.length <= 1) return null;

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-gray-700">Site:</label>
      <select
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
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
