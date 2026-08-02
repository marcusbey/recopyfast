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
  const [error, setError] = useState<string | null>(null);

  const fetchSites = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/sites");
      if (!res.ok) {
        // Falling through here rendered "No sites found" on every outage,
        // which reads as "your account is empty" rather than "we failed".
        let message = `Failed to load sites (${res.status})`;
        try {
          const body: unknown = await res.json();
          const serverMessage = (body as { error?: unknown }).error;
          if (typeof serverMessage === "string" && serverMessage) {
            message = serverMessage;
          }
        } catch {
          // Non-JSON body — keep the status-qualified message.
        }
        throw new Error(message);
      }

      const data = await res.json();
      const fetched: Site[] = data.sites || [];
      setSites(fetched);
      if (!initialSiteId && fetched.length > 0) {
        setSelectedSiteId((prev) => prev || fetched[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sites");
    } finally {
      setLoading(false);
    }
  }, [initialSiteId]);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  return {
    sites,
    selectedSiteId,
    setSelectedSiteId,
    loading,
    error,
    refetch: fetchSites,
  };
}
