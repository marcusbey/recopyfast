"use client";

import {
  StatusBadge,
  abTestStatuses,
  resolveStatus,
} from "@/components/ui/status-badge";

interface ABTestStatusBadgeProps {
  status: string;
}

export function ABTestStatusBadge({ status }: ABTestStatusBadgeProps) {
  return (
    <StatusBadge
      status={resolveStatus(abTestStatuses, status, "draft")}
      className="text-xs"
    />
  );
}
