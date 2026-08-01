"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Eye,
  MousePointerClick,
} from "lucide-react";
import type { VariantStat, SignificanceResult } from "@/hooks/useABTestResults";

interface ABTestVariantCardProps {
  stat: VariantStat;
  significanceResult?: SignificanceResult;
  isBest: boolean;
  isControl: boolean;
}

export function ABTestVariantCard({
  stat,
  significanceResult,
  isBest,
  isControl,
}: ABTestVariantCardProps) {
  const conversionPct = (stat.conversion_rate * 100).toFixed(2);

  return (
    <Card className={isBest ? "border-green-300 bg-green-50/50" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{stat.variant_name}</span>
              {isBest && (
                <Badge className="bg-green-100 text-xs text-green-700">
                  <Trophy className="mr-1 h-3 w-3" />
                  Leading
                </Badge>
              )}
              {isControl && (
                <Badge variant="outline" className="text-xs">
                  Control
                </Badge>
              )}
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {stat.views.toLocaleString()} views
              </span>
              <span className="flex items-center gap-1">
                <MousePointerClick className="h-3 w-3" />
                {stat.conversions.toLocaleString()} conversions
              </span>
            </div>
          </div>

          <div className="text-right">
            <p className="text-lg font-semibold">{conversionPct}%</p>
            <p className="text-xs text-gray-500">conversion rate</p>
          </div>
        </div>

        {/* Conversion bar */}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full ${isBest ? "bg-green-500" : "bg-blue-400"}`}
            style={{
              width: `${Math.min(stat.conversion_rate * 100 * 10, 100)}%`,
            }}
          />
        </div>

        {/* Significance info */}
        {significanceResult && (
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span
              className={`flex items-center gap-1 ${significanceResult.lift >= 0 ? "text-green-600" : "text-red-600"}`}
            >
              {significanceResult.lift >= 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {significanceResult.lift >= 0 ? "+" : ""}
              {significanceResult.lift.toFixed(1)}% lift
            </span>
            <span className="text-gray-500">
              {significanceResult.confidence.toFixed(1)}% confidence
            </span>
            {significanceResult.significance && (
              <Badge className="bg-green-100 text-xs text-green-700">
                Significant
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
