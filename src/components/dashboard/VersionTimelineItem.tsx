"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, RotateCcw, FileText, User, Clock } from "lucide-react";
import { format } from "date-fns";

export interface Version {
  id: string;
  versionNumber: number;
  createdBy: string;
  description: string | null;
  elementsChanged: number;
  changeType: "manual" | "auto" | "publish" | "restore" | "bulk";
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

const changeTypeLabels = {
  manual: "Manual edit",
  auto: "Auto-save",
  publish: "Published",
  restore: "Restored",
  bulk: "Bulk edit",
};

const changeTypeColors = {
  manual: "bg-blue-100 text-blue-700 border-blue-200",
  auto: "bg-gray-100 text-gray-600 border-gray-200",
  publish: "bg-green-100 text-green-700 border-green-200",
  restore: "bg-purple-100 text-purple-700 border-purple-200",
  bulk: "bg-amber-100 text-amber-700 border-amber-200",
};

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
          className={`w-3 h-3 rounded-full ${
            isFirst
              ? "bg-green-500 ring-4 ring-green-100"
              : "bg-gray-300 ring-2 ring-gray-100"
          }`}
        />
        {!isLast && (
          <div className="w-0.5 h-full bg-gray-200 absolute top-4 left-[5px]" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-gray-900">
                  {isFirst
                    ? "Current Version"
                    : `Version ${version.versionNumber}`}
                </h4>
                <Badge
                  variant="outline"
                  className={changeTypeColors[version.changeType]}
                >
                  {changeTypeLabels[version.changeType]}
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {format(createdDate, "MMM d, yyyy")} at{" "}
                  {format(createdDate, "h:mm a")}
                </span>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <User className="w-4 h-4 text-gray-400" />
              <span>{version.createdBy}</span>
            </div>
            {version.description && (
              <p className="text-sm text-gray-700 italic">
                &ldquo;{version.description}&rdquo;
              </p>
            )}
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <FileText className="w-4 h-4 text-gray-400" />
              <span>{version.elementsChanged} elements changed</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
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
