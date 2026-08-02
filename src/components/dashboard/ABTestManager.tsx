"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FlaskConical, Plus, Loader2 } from "lucide-react";
import { useABTests } from "@/hooks/useABTests";
import { ABTestCard } from "@/components/dashboard/ABTestCard";

interface ABTestManagerProps {
  siteId: string;
  onCreateTest?: () => void;
  onViewResults?: (testId: string) => void;
}

export default function ABTestManager({
  siteId,
  onCreateTest,
  onViewResults,
}: ABTestManagerProps) {
  const { tests, loading, error, actionLoading, updateStatus, refetch } =
    useABTests(siteId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">A/B Copy Tests</h2>
          <p className="text-sm text-muted-foreground">
            Test copy variations to optimize conversions
          </p>
        </div>
        <Button onClick={onCreateTest} size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Generate A/B Test
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-tone-danger-border bg-tone-danger-surface px-3 py-2 text-sm text-tone-danger-text"
        >
          {error}{" "}
          <button
            type="button"
            onClick={refetch}
            className="underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      )}

      {/* Only claim "no tests yet" when the fetch actually succeeded. */}
      {tests.length === 0 && !error ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FlaskConical className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              No A/B tests yet
            </p>
            <p className="mb-4 text-xs text-muted-foreground">
              AI will generate optimized copy variants for you
            </p>
            <Button onClick={onCreateTest} size="sm" variant="outline">
              <Plus className="mr-1 h-4 w-4" />
              Create Your First Test
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tests.map((test) => (
            <ABTestCard
              key={test.id}
              test={test}
              onStatusChange={updateStatus}
              onViewResults={(testId) => onViewResults?.(testId)}
              isLoading={actionLoading === test.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
