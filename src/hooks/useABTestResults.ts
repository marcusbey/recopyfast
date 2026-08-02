"use client";

import { useState, useEffect, useCallback } from "react";

export interface VariantStat {
  variant_id: string;
  variant_name: string;
  traffic_percentage: number;
  views: number;
  conversions: number;
  conversion_rate: number;
  total_value: number;
}

export interface SignificanceResult {
  variant_id: string;
  variant_name: string;
  lift: number;
  significance: boolean;
  confidence: number;
  p_value: number;
}

export interface TestStatistics {
  variant_stats: VariantStat[];
  significance_results: SignificanceResult[];
  total_participants: number;
  test_duration_days: number;
}

export interface TestResultsData {
  test: { name: string; site_id: string };
  results: Array<Record<string, unknown>>;
  variants: Array<Record<string, unknown>>;
  statistics: TestStatistics;
}

export function useABTestResults(testId: string) {
  const [data, setData] = useState<TestResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    if (!testId) return;
    try {
      const response = await fetch(`/api/ab-tests/${testId}/results`);
      if (!response.ok) {
        let message = `Failed to load test results (${response.status})`;
        try {
          const body: unknown = await response.json();
          const serverMessage = (body as { error?: unknown }).error;
          if (typeof serverMessage === "string" && serverMessage) {
            message = serverMessage;
          }
        } catch {
          // Non-JSON body — keep the status-qualified message.
        }
        throw new Error(message);
      }

      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      // This polls every 30s. Keep the last good results on screen and report
      // the failure rather than blanking the page on a single bad poll.
      setError(
        err instanceof Error ? err.message : "Failed to load test results",
      );
    } finally {
      setLoading(false);
    }
  }, [testId]);

  useEffect(() => {
    fetchResults();
    const interval = setInterval(fetchResults, 30000);
    return () => clearInterval(interval);
  }, [fetchResults]);

  return { data, loading, error, refetch: fetchResults };
}
