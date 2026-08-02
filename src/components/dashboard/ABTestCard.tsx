"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Pause, BarChart3, Loader2 } from "lucide-react";
import { ABTestStatusBadge } from "@/components/dashboard/ABTestStatusBadge";
import type { ABTest } from "@/types";

interface ABTestCardProps {
  test: ABTest;
  onStatusChange: (testId: string, newStatus: string) => void;
  onViewResults: (testId: string) => void;
  isLoading: boolean;
}

export function ABTestCard({
  test,
  onStatusChange,
  onViewResults,
  isLoading,
}: ABTestCardProps) {
  const variantCount = test.variants?.length || 0;

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium">{test.name}</h3>
            <ABTestStatusBadge status={test.status} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{variantCount} variants</span>
            {test.target_element_id && (
              <span>Target: {test.target_element_id}</span>
            )}
            {test.success_metric && <span>Metric: {test.success_metric}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {test.status === "draft" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatusChange(test.id, "active")}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Play className="mr-1 h-3 w-3" />
                  Activate
                </>
              )}
            </Button>
          )}
          {test.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatusChange(test.id, "paused")}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Pause className="mr-1 h-3 w-3" />
                  Pause
                </>
              )}
            </Button>
          )}
          {test.status === "paused" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatusChange(test.id, "active")}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Play className="mr-1 h-3 w-3" />
                  Resume
                </>
              )}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`View results for ${test.name}`}
            onClick={() => onViewResults(test.id)}
          >
            <BarChart3 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
