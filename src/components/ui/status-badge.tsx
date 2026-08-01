"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  FlaskConical,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Layers,
  Trophy,
  Upload,
} from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

/**
 * Single source of truth for every status pill in the dashboard.
 *
 * Before this existed the same treatment (a green-100 surface with green-700
 * text and a green-200 edge, and friends) was re-declared in SiteCard, SiteDetailView,
 * ContentElementCard, VersionTimelineItem, ABTestStatusBadge and StagingDiff —
 * six maps that had already drifted apart. Adding a status now means adding one
 * entry here.
 */

export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

type IconComponent = React.ComponentType<{ className?: string }>;

interface StatusDefinition {
  label: string;
  tone: StatusTone;
  icon: IconComponent;
  /** Shown as the pill's title attribute and reused by detail views. */
  description: string;
}

export type SiteStatus = "active" | "inactive" | "verifying";
export type ContentStatus = "original" | "edited" | "pending";
export type VersionChangeType =
  | "manual"
  | "auto"
  | "publish"
  | "restore"
  | "bulk";
export type ABTestStatus =
  | "draft"
  | "active"
  | "running"
  | "paused"
  | "completed";

export const siteStatuses: Record<SiteStatus, StatusDefinition> = {
  active: {
    label: "Active",
    tone: "success",
    icon: CheckCircle2,
    description: "Site is verified and operational",
  },
  inactive: {
    label: "Inactive",
    tone: "neutral",
    icon: AlertCircle,
    description: "Site is not currently active",
  },
  verifying: {
    label: "Verifying",
    tone: "warning",
    icon: Clock,
    description: "Site verification in progress",
  },
};

export const contentStatuses: Record<ContentStatus, StatusDefinition> = {
  original: {
    label: "Original",
    tone: "neutral",
    icon: FileText,
    description: "Unchanged since ReCopyFast first read this element",
  },
  edited: {
    label: "Edited",
    tone: "info",
    icon: PencilLine,
    description: "Edited and live on your site",
  },
  pending: {
    label: "Pending",
    tone: "warning",
    icon: Clock,
    description: "Edited in staging, not published yet",
  },
};

export const versionChangeTypes: Record<VersionChangeType, StatusDefinition> = {
  manual: {
    label: "Manual edit",
    tone: "info",
    icon: PencilLine,
    description: "Saved by hand from the edit board",
  },
  auto: {
    label: "Auto-save",
    tone: "neutral",
    icon: Clock,
    description: "Captured automatically",
  },
  publish: {
    label: "Published",
    tone: "success",
    icon: Upload,
    description: "Staging content pushed live",
  },
  restore: {
    label: "Restored",
    tone: "accent",
    icon: RotateCcw,
    description: "Rolled back to an earlier version",
  },
  bulk: {
    label: "Bulk edit",
    tone: "warning",
    icon: Layers,
    description: "Many elements changed at once",
  },
};

export const abTestStatuses: Record<ABTestStatus, StatusDefinition> = {
  draft: {
    label: "Draft",
    tone: "neutral",
    icon: FlaskConical,
    description: "Not started",
  },
  active: {
    label: "Active",
    tone: "success",
    icon: Play,
    description: "Serving traffic",
  },
  running: {
    label: "Running",
    tone: "info",
    icon: Play,
    description: "Serving traffic",
  },
  paused: {
    label: "Paused",
    tone: "warning",
    icon: Pause,
    description: "Temporarily stopped",
  },
  completed: {
    label: "Completed",
    tone: "accent",
    icon: Trophy,
    description: "Finished, winner picked",
  },
};

const toneVariant: Record<StatusTone, NonNullable<BadgeProps["variant"]>> = {
  neutral: "tone-neutral",
  info: "tone-info",
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
  accent: "tone-accent",
};

interface StatusBadgeProps extends Omit<BadgeProps, "variant" | "children"> {
  status: StatusDefinition;
  /** Hide the leading icon when the surrounding row already carries meaning. */
  hideIcon?: boolean;
}

export function StatusBadge({
  status,
  hideIcon = false,
  className,
  ...props
}: StatusBadgeProps) {
  const Icon = status.icon;

  return (
    <Badge
      variant={toneVariant[status.tone]}
      className={cn("gap-1", className)}
      title={status.description}
      {...props}
    >
      {!hideIcon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {status.label}
    </Badge>
  );
}

/** Resolves an unknown status string against a registry, falling back safely. */
export function resolveStatus<K extends string>(
  registry: Record<K, StatusDefinition>,
  key: string | undefined,
  fallback: K,
): StatusDefinition {
  return registry[(key ?? fallback) as K] ?? registry[fallback];
}
