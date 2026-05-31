"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Users, BarChart3, Trophy } from "lucide-react";

interface ABTestOverviewStatsProps {
  totalParticipants: number;
  testDurationDays: number;
  bestConversionRate: number;
}

export function ABTestOverviewStats({
  totalParticipants,
  testDurationDays,
  bestConversionRate,
}: ABTestOverviewStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Users className="h-3 w-3" />
            Participants
          </div>
          <p className="mt-1 text-2xl font-semibold">
            {totalParticipants.toLocaleString()}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <BarChart3 className="h-3 w-3" />
            Duration
          </div>
          <p className="mt-1 text-2xl font-semibold">{testDurationDays}d</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Trophy className="h-3 w-3" />
            Best CR
          </div>
          <p className="mt-1 text-2xl font-semibold">
            {(bestConversionRate * 100).toFixed(2)}%
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
