"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Eye,
  Edit,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export interface ContentElement {
  id: string;
  siteId: string;
  siteDomain: string;
  elementId: string;
  selector: string;
  originalContent: string;
  currentContent: string;
  stagingContent?: string;
  publishedContent?: string;
  language: string;
  variant: string;
  metadata?: {
    type?: string;
  };
  lastModified: string;
}

interface ContentElementCardProps {
  element: ContentElement;
  onView?: (element: ContentElement) => void;
  onEdit?: (element: ContentElement) => void;
  onHistory?: (element: ContentElement) => void;
}

type ContentStatus = "original" | "edited" | "pending";

function getStatus(element: ContentElement): ContentStatus {
  if (
    element.stagingContent &&
    element.stagingContent !== element.publishedContent
  ) {
    return "pending";
  }
  if (element.currentContent !== element.originalContent) {
    return "edited";
  }
  return "original";
}

const statusConfig = {
  original: {
    label: "Original",
    className: "bg-gray-100 text-gray-600 border-gray-200",
  },
  edited: {
    label: "Edited",
    className: "bg-blue-100 text-blue-600 border-blue-200",
  },
  pending: {
    label: "Pending",
    className: "bg-amber-100 text-amber-600 border-amber-200",
  },
};

export function ContentElementCard({
  element,
  onView,
  onEdit,
  onHistory,
}: ContentElementCardProps) {
  const [expanded, setExpanded] = useState(false);
  const status = getStatus(element);
  const hasChanges =
    element.currentContent !== element.originalContent ||
    (element.stagingContent &&
      element.stagingContent !== element.publishedContent);

  const truncateText = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  return (
    <Card className="hover:shadow-md transition-shadow border-gray-200">
      <CardContent className="p-0">
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="font-mono text-sm font-medium text-gray-900">
                {element.elementId}
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Globe className="w-3 h-3" />
                {element.siteDomain}
              </div>
            </div>
            <Badge variant="outline" className={statusConfig[status].className}>
              {statusConfig[status].label}
            </Badge>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Original */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Original:</p>
            <p className="text-sm text-gray-700">
              {expanded
                ? element.originalContent
                : truncateText(element.originalContent)}
            </p>
          </div>

          {/* Current (if different) */}
          {element.currentContent !== element.originalContent && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Current:</p>
              <p className="text-sm text-blue-700">
                {expanded
                  ? element.currentContent
                  : truncateText(element.currentContent)}
              </p>
            </div>
          )}

          {/* Staging (if exists and different) */}
          {element.stagingContent &&
            element.stagingContent !== element.currentContent && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">
                  Staging:
                </p>
                <p className="text-sm text-amber-700">
                  {expanded
                    ? element.stagingContent
                    : truncateText(element.stagingContent)}
                </p>
              </div>
            )}

          {/* Expand/Collapse for long content */}
          {(element.originalContent.length > 100 ||
            element.currentContent.length > 100) && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  Show more
                </>
              )}
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Last edited:{" "}
            {element.lastModified
              ? new Date(element.lastModified).toLocaleDateString()
              : "—"}
          </p>
          <div className="flex items-center gap-2">
            {onView && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onView(element)}
                className="h-7 text-xs"
              >
                <Eye className="w-3 h-3 mr-1" />
                View
              </Button>
            )}
            {onEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(element)}
                className="h-7 text-xs"
              >
                <Edit className="w-3 h-3 mr-1" />
                Edit
              </Button>
            )}
            {onHistory && hasChanges && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onHistory(element)}
                className="h-7 text-xs"
              >
                <History className="w-3 h-3 mr-1" />
                History
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
