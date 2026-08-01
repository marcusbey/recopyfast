"use client";

import { useId, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  StatusBadge,
  contentStatuses,
  type ContentStatus,
} from "@/components/ui/status-badge";
import { ContentValue, classifyContent } from "@/components/ui/content-value";
import {
  Globe,
  Eye,
  Edit,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

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

export type { ContentStatus };

/**
 * Shared by the card and the content list's filter so both agree on what
 * "edited" means.
 */
export function getContentStatus(element: ContentElement): ContentStatus {
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

/** Text long enough that collapsing it earns its keep. */
const CLAMP_THRESHOLD = 160;

interface ContentRowProps {
  label: string;
  value: string;
  metadataType?: string;
  elementId: string;
  expanded: boolean;
  /** Left rule colour, so the three states are distinguishable at a glance. */
  accentClassName: string;
}

function ContentRow({
  label,
  value,
  metadataType,
  elementId,
  expanded,
  accentClassName,
}: ContentRowProps) {
  return (
    <div className={cn("border-l-2 pl-3", accentClassName)}>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ContentValue
        value={value}
        metadataType={metadataType}
        label={`${label} content for ${elementId}`}
        expanded={expanded}
      />
    </div>
  );
}

export function ContentElementCard({
  element,
  onView,
  onEdit,
  onHistory,
}: ContentElementCardProps) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const status = getContentStatus(element);
  const hasChanges = status !== "original";

  const isEdited = element.currentContent !== element.originalContent;
  const hasStaging =
    !!element.stagingContent &&
    element.stagingContent !== element.currentContent;

  // Only text benefits from expanding — images always render at full frame.
  const isTextual =
    classifyContent(element.originalContent, element.metadata?.type) === "text";
  const canExpand =
    isTextual &&
    [
      element.originalContent,
      element.currentContent,
      element.stagingContent ?? "",
    ].some((value) => value.length > CLAMP_THRESHOLD);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-0">
        {/* Header */}
        <div className="border-b border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p
                className="truncate font-mono text-sm font-medium text-foreground"
                title={element.elementId}
              >
                {element.elementId}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {element.siteDomain}
                </span>
                <span className="truncate font-mono" title={element.selector}>
                  {element.selector}
                </span>
              </div>
            </div>
            <StatusBadge status={contentStatuses[status]} />
          </div>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4" id={bodyId}>
          <ContentRow
            label="Original"
            value={element.originalContent}
            metadataType={element.metadata?.type}
            elementId={element.elementId}
            expanded={expanded}
            accentClassName="border-l-border"
          />

          {isEdited && (
            <ContentRow
              label="Live"
              value={element.currentContent}
              metadataType={element.metadata?.type}
              elementId={element.elementId}
              expanded={expanded}
              accentClassName="border-l-tone-info-border"
            />
          )}

          {hasStaging && (
            <ContentRow
              label="Staging"
              value={element.stagingContent!}
              metadataType={element.metadata?.type}
              elementId={element.elementId}
              expanded={expanded}
              accentClassName="border-l-tone-warning-border"
            />
          )}

          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls={bodyId}
              className="flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" aria-hidden="true" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                  Show more
                </>
              )}
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-1 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Last edited:{" "}
            {element.lastModified
              ? new Date(element.lastModified).toLocaleDateString()
              : "—"}
          </p>
          <div className="flex items-center gap-1">
            {onView && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onView(element)}
                className="h-8 text-xs"
              >
                <Eye className="mr-1 h-3 w-3" aria-hidden="true" />
                View
                <span className="sr-only">
                  {" "}
                  {element.elementId} on the site
                </span>
              </Button>
            )}
            {onEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(element)}
                className="h-8 text-xs"
              >
                <Edit className="mr-1 h-3 w-3" aria-hidden="true" />
                Edit
                <span className="sr-only"> {element.elementId}</span>
              </Button>
            )}
            {onHistory && hasChanges && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onHistory(element)}
                className="h-8 text-xs"
              >
                <History className="mr-1 h-3 w-3" aria-hidden="true" />
                History
                <span className="sr-only"> for {element.elementId}</span>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
