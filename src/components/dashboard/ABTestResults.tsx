"use client";

import { Loader2 } from "lucide-react";
import { useABTestResults } from "@/hooks/useABTestResults";
import { ABTestOverviewStats } from "@/components/dashboard/ab-results/ABTestOverviewStats";
import { ABTestVariantCard } from "@/components/dashboard/ab-results/ABTestVariantCard";

interface ABTestResultsProps {
  testId: string;
}

export default function ABTestResults({ testId }: ABTestResultsProps) {
  const { data, loading } = useABTestResults(testId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Failed to load test results
      </div>
    );
  }

  const { statistics } = data;

  if (!statistics.variant_stats?.length) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        No variant performance data yet
      </div>
    );
  }

  const bestVariant = statistics.variant_stats.reduce((best, current) =>
    current.conversion_rate > best.conversion_rate ? current : best,
  );

  return (
    <div className="space-y-6">
      <ABTestOverviewStats
        totalParticipants={statistics.total_participants}
        testDurationDays={statistics.test_duration_days}
        bestConversionRate={bestVariant.conversion_rate}
      />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Variant Performance</h3>
        {statistics.variant_stats.map((stat, index) => {
          const sigResult = statistics.significance_results.find(
            (s) => s.variant_id === stat.variant_id,
          );
          return (
            <ABTestVariantCard
              key={stat.variant_id}
              stat={stat}
              significanceResult={sigResult}
              isBest={stat.variant_id === bestVariant.variant_id}
              isControl={index === 0}
            />
          );
        })}
      </div>
    </div>
  );
}
