"use client";

import { useState, useEffect, useCallback } from "react";
import type { ABTest } from "@/types";

/**
 * Surface the server's message for a failed request. A non-ok response that
 * falls through silently renders as "you have no tests", which is a worse lie
 * than an error.
 */
async function readError(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: unknown }).error;
    if (typeof message === "string" && message) return message;
  } catch {
    // Non-JSON body — fall back to a status-qualified message.
  }
  return `${fallback} (${response.status})`;
}

export function useABTests(siteId: string) {
  const [tests, setTests] = useState<ABTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchTests = useCallback(async () => {
    if (!siteId) return;
    setError(null);
    try {
      const response = await fetch(`/api/ab-tests?siteId=${siteId}`);
      if (!response.ok) {
        throw new Error(await readError(response, "Failed to load A/B tests"));
      }
      const data = await response.json();
      setTests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load A/B tests");
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
      setError(null);
      try {
        const response = await fetch("/api/ab-tests", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test_id: testId, status: newStatus }),
        });
        if (!response.ok) {
          throw new Error(
            await readError(response, "Failed to update test status"),
          );
        }
        await fetchTests();
      } catch (err) {
        // A rejected status change previously left the old status on screen
        // with no indication the click had failed.
        setError(
          err instanceof Error ? err.message : "Failed to update test status",
        );
      } finally {
        setActionLoading(null);
      }
    },
    [fetchTests],
  );

  return {
    tests,
    loading,
    error,
    actionLoading,
    updateStatus,
    refetch: fetchTests,
  };
}
