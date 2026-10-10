"use client";

import { useEffect, useState } from "react";
import { AnalyticsDashboard } from "@/components/dashboard/AnalyticsDashboard";
import type { Site } from "@/types";

export default function AnalyticsPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSites();
  }, []);

  const fetchSites = async () => {
    try {
      const response = await fetch("/api/sites");
      if (response.ok) {
        const data = await response.json();
        setSites(data.sites || []);
      }
    } catch (error) {
      console.error("Error fetching sites:", error);
    } finally {
      setLoading(false);
    }
  };

  // The frame renders while the sites load; only its body waits. This used
  // to return a bare spinner here, so the page had no title at all for its
  // first request (s66b1, ADR 053).
  return <AnalyticsDashboard sites={sites} isLoadingSites={loading} />;
}
