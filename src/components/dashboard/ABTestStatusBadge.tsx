"use client";

import { Badge } from "@/components/ui/badge";
import { FlaskConical, Play, Pause, Trophy } from "lucide-react";

const statusConfig: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  draft: {
    label: "Draft",
    color: "bg-gray-100 text-gray-700",
    icon: <FlaskConical className="h-3 w-3" />,
  },
  active: {
    label: "Active",
    color: "bg-green-100 text-green-700",
    icon: <Play className="h-3 w-3" />,
  },
  running: {
    label: "Running",
    color: "bg-blue-100 text-blue-700",
    icon: <Play className="h-3 w-3" />,
  },
  paused: {
    label: "Paused",
    color: "bg-yellow-100 text-yellow-700",
    icon: <Pause className="h-3 w-3" />,
  },
  completed: {
    label: "Completed",
    color: "bg-purple-100 text-purple-700",
    icon: <Trophy className="h-3 w-3" />,
  },
};

interface ABTestStatusBadgeProps {
  status: string;
}

export function ABTestStatusBadge({ status }: ABTestStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.draft;

  return (
    <Badge variant="secondary" className={`text-xs ${config.color}`}>
      {config.icon}
      <span className="ml-1">{config.label}</span>
    </Badge>
  );
}
