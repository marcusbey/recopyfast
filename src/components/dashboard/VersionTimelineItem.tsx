"use client";

import { Button } from "@/components/ui/button";
import {
  StatusBadge,
  versionChangeTypes,
  resolveStatus,
  type VersionChangeType,
} from "@/components/ui/status-badge";
import { Eye, RotateCcw, FileText, User, Clock } from "lucide-react";
import { format } from "date-fns";

export interface Version {
  id: string;
  versionNumber: number;
  createdBy: string;
  description: string | null;
  elementsChanged: number;
  changeType: VersionChangeType;
  createdAt: string;
  snapshot?: Record<string, unknown>[];
}

interface VersionTimelineItemProps {
  version: Version;
  isFirst: boolean;
  isLast: boolean;
  onView: (version: Version) => void;
  onRestore?: (version: Version) => void;
}

export function VersionTimelineItem({
  version,
  isFirst,
  isLast,
  onView,
  onRestore,
}: VersionTimelineItemProps) {
  const createdDate = new Date(version.createdAt);

  return (
    <div className="relative flex gap-4">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div
          className={`h-3 w-3 rounded-full ${
            isFirst
              ? "bg-success ring-4 ring-tone-success-surface"
              : "bg-muted-foreground/40 ring-2 ring-muted"
          }`}
        />
        {!isLast && (
          <div className="absolute left-[5px] top-4 h-full w-0.5 bg-border" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-md">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-foreground">
                  {isFirst
                    ? "Current Version"
                    : `Version ${version.versionNumber}`}
                </h4>
                <StatusBadge
                  status={resolveStatus(
                    versionChangeTypes,
                    version.changeType,
                    "manual",
                  )}
                />
              </div>
              <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {format(createdDate, "MMM d, yyyy")} at{" "}
                  {format(createdDate, "h:mm a")}
                </span>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="w-4 h-4 text-muted-foreground" />
              <span>{version.createdBy}</span>
            </div>
            {version.description && (
              <p className="text-sm text-foreground italic">
                &ldquo;{version.description}&rdquo;
              </p>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span>{version.elementsChanged} elements changed</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onView(version)}
              className="text-xs"
            >
              <Eye className="w-3 h-3 mr-1" />
              View
            </Button>
            {!isFirst && onRestore && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRestore(version)}
                className="text-xs"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Restore
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
