"use client";

import { useState, useEffect, useCallback } from "react";
import type { ABTest } from "@/types";

export function useABTests(siteId: string) {
  const [tests, setTests] = useState<ABTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchTests = useCallback(async () => {
    if (!siteId) return;
    try {
      const response = await fetch(`/api/ab-tests?siteId=${siteId}`);
      if (response.ok) {
        const data = await response.json();
        setTests(data);
      }
    } catch (error) {
      console.error("Error fetching A/B tests:", error);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchTests();
  }, [fetchTests]);

  const updateStatus = useCallback(
    async (testId: string, newStatus: string) => {
      setActionLoading(testId);
      try {
        const response = await fetch("/api/ab-tests", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test_id: testId, status: newStatus }),
        });
        if (response.ok) {
          await fetchTests();
        }
      } catch (error) {
        console.error("Error updating test status:", error);
      } finally {
        setActionLoading(null);
      }
    },
    [fetchTests],
  );

  return { tests, loading, actionLoading, updateStatus, refetch: fetchTests };
}
