"use client";

import { useState, useEffect, useCallback } from "react";

interface Site {
  id: string;
  name: string;
  domain: string;
}

export function useSites(initialSiteId?: string) {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState(initialSiteId || "");
  const [loading, setLoading] = useState(true);

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) {
        const data = await res.json();
        const fetched: Site[] = data.sites || [];
        setSites(fetched);
        if (!initialSiteId && fetched.length > 0) {
          setSelectedSiteId((prev) => prev || fetched[0].id);
        }
      }
    } catch (error) {
      console.error("Error fetching sites:", error);
    } finally {
      setLoading(false);
    }
  }, [initialSiteId]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  return { sites, selectedSiteId, setSelectedSiteId, loading };
}
