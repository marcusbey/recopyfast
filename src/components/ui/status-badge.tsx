"use client";

import * as React from "react";
import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
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
  Wand2,
} from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { WebhookDeliveryStatus } from "@/types";

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

export type SiteStatus = "awaiting-install" | "live" | "stale";
export type ContentStatus = "original" | "edited" | "pending";
/**
 * Keyed by the raw `content_versions.change_type` string, which is what
 * `VersionHistoryPanel` passes through unmodified. The key was `bulk`, a value
 * the column has never been able to hold: its CHECK constraint
 * (`20251230100000_edit_board.sql:69`) allows only
 * ('manual','style_apply','language_switch','theme_apply','restore','bulk_edit').
 * `resolveStatus` falls back to `manual`, so every bulk snapshot rendered as
 * "Saved by hand from the edit board" — silently, because a fallback looks the
 * same as a match.
 *
 * `style_apply` was the same miss in the other direction: a value the registry
 * did not carry, written on every AI style application
 * (`edit-board/styles/apply/route.ts:176`), so those versions rendered as
 * "Manual edit" too.
 *
 * `language_switch` and `theme_apply` are also CHECK-legal and also absent
 * here. They are written — `server/index.js:810` and `:983` — but that Socket.io
 * service is **not deployed** (`AGENTS.md`, `docs/architecture.md`), so no row
 * in production carries either value and there is no live mislabelling to fix
 * today. [ADR 023](../../../docs/decisions/023-websocket-only-transport-no-sticky-routing.md)
 * has `s07b` standing that service up; **the moment it ships, both render as
 * "Manual edit"** and this registry needs the two entries.
 *
 * `auto` and `publish` are the reverse — entries the column cannot hold, kept
 * because removing them is not this story's to do.
 */
export type VersionChangeType =
  | "manual"
  | "auto"
  | "publish"
  | "restore"
  | "style_apply"
  | "bulk_edit";
export type ABTestStatus =
  | "draft"
  | "active"
  | "running"
  | "paused"
  | "completed";

/**
 * What a site's status actually means, as opposed to what it used to say.
 *
 * `GET /api/sites` derived the flag from exactly one thing — `content_elements`
 * rows exist for this site, or they do not. It has never consulted
 * `domain_verifications`, and nothing else does either: the embed script is
 * admitted by `authorizeSiteRequest`, which checks an HMAC site token and the
 * request origin against `sites.domain`. A site with no verification record at
 * all serves and saves content perfectly.
 *
 * So the entry that used to sit here — "Verifying / Site verification in
 * progress" — described a process that does not exist, could not be started
 * from anywhere in the dashboard, and that no owner action would ever finish.
 * Two live sites sat on it indefinitely while their script worked, and the
 * overview counted them as zero. (The widget not reporting its content map at
 * all was the other half of that; see register F-10.)
 *
 * `active` / `inactive` / `verifying` are RETIRED, not aliased. They were three
 * words for one snapshot — "do we hold rows for this site" — recomputed per
 * request, with nowhere to record when anything changed. `sites.status` is now
 * a real state machine (`awaiting-install` → `live`, ADR 006) and `stale` is
 * derived from `last_reported_at` at read time. Keeping the old words alongside
 * would have left two vocabularies for one fact, which is the exact drift this
 * registry exists to stop.
 */
export const siteStatuses: Record<SiteStatus, StatusDefinition> = {
  "awaiting-install": {
    label: "Awaiting install",
    tone: "neutral",
    icon: CircleDashed,
    description:
      "Registered and ready. Add the snippet to your site and this turns itself green — nothing here needs your approval.",
  },
  live: {
    label: "Live",
    tone: "success",
    icon: CheckCircle2,
    description: "The script on this site has reported in. Editing is on.",
  },
  stale: {
    label: "Stale",
    tone: "warning",
    icon: Clock,
    description:
      "No report from this site recently. Nothing is blocked — content still serves and the site stays editable.",
  },
};

/**
 * Falls back safely when the API sends a status this build does not know.
 *
 * The fallback is `awaiting-install`, the state that claims nothing. It used to
 * be `inactive`, and before that a site the API said nothing about was drawn as
 * healthy — the one direction a default must never guess in. `stale` is not the
 * safe fallback either: it asserts the site was verified once.
 */
export function resolveSiteStatus(
  status: string | undefined,
): StatusDefinition {
  return (
    siteStatuses[(status ?? "awaiting-install") as SiteStatus] ??
    siteStatuses["awaiting-install"]
  );
}

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
  style_apply: {
    label: "Style applied",
    tone: "accent",
    icon: Wand2,
    description: "AI rewrote the copy in a saved style",
  },
  bulk_edit: {
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

/**
 * Webhook delivery outcomes. Added here rather than mapped inside
 * WebhooksPanel for the reason this file exists at the top: six drifted copies
 * of the same treatment is what it replaced, and a seventh living in a panel
 * would be the first step back.
 */
export const webhookDeliveryStatuses: Record<
  WebhookDeliveryStatus,
  StatusDefinition
> = {
  pending: {
    label: "Pending",
    tone: "neutral",
    icon: Clock,
    description: "Waiting for the batching window to close",
  },
  delivered: {
    label: "Delivered",
    tone: "success",
    icon: CheckCircle2,
    description: "Your endpoint accepted this delivery",
  },
  retrying: {
    label: "Retrying",
    tone: "warning",
    icon: RotateCcw,
    description: "The attempt failed and another is scheduled",
  },
  failed: {
    label: "Failed",
    tone: "danger",
    icon: CircleSlash,
    description: "Every attempt failed — no further attempts will be made",
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
