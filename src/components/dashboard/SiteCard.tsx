"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  StatusBadge,
  siteStatuses,
  type SiteStatus,
} from "@/components/ui/status-badge";
import {
  Globe,
  MoreVertical,
  Eye,
  Settings,
  Trash2,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { ShareButton } from "./ShareButton";
import { formatDistanceToNow } from "date-fns";
import type { Site } from "@/types";

export type { SiteStatus };

interface SiteWithStats extends Site {
  stats?: {
    edits_count?: number;
    views?: number;
    last_activity?: string;
  };
  status?: SiteStatus;
}

interface SiteCardProps {
  site: SiteWithStats;
  onViewDetails: (siteId: string) => void;
  onEdit: (siteId: string) => void;
  onDelete: (siteId: string) => void;
}

export function SiteCard({
  site,
  onViewDetails,
  onEdit,
  onDelete,
}: SiteCardProps) {
  const [copied, setCopied] = useState(false);
  const status = site.status || "active";

  const handleCopyDomain = async () => {
    await navigator.clipboard.writeText(site.domain);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lastEdited = site.updated_at
    ? formatDistanceToNow(new Date(site.updated_at), { addSuffix: true })
    : "Never";

  return (
    <Card variant="outline" className="group">
      <CardContent className="px-5 pb-5 pt-5">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <IconTile size="lg">
              <Globe aria-hidden="true" />
            </IconTile>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-title">{site.name}</h3>
              <div className="mt-0.5 flex items-center gap-1">
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {site.domain}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100"
                  onClick={handleCopyDomain}
                  title="Copy domain"
                >
                  {copied ? (
                    <CheckCircle2 className="h-3 w-3 text-tone-success-text" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100"
              >
                <MoreVertical className="w-4 h-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => onViewDetails(site.id)}>
                <Eye className="w-4 h-4 mr-2" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(site.id)}>
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(site.id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Site
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge status={siteStatuses[status]} />
          <span className="text-xs text-muted-foreground">
            Last edited {lastEdited}
          </span>
        </div>

        {/* Figures are tabular so the three columns keep their gridlines as
            counts change; the labels sit under the numbers because the number
            is what the eye is looking for. */}
        <dl className="grid grid-cols-3 gap-3 border-t border-border pt-4">
          <div>
            <dd className="text-metric text-lg">
              {site.stats?.edits_count || 0}
            </dd>
            <dt className="text-eyebrow mt-1">Edits</dt>
          </div>
          <div>
            <dd className="text-metric text-lg">{site.stats?.views || 0}</dd>
            <dt className="text-eyebrow mt-1">Views</dt>
          </div>
          <div className="min-w-0">
            <dd className="truncate text-lg font-semibold leading-none tracking-[-0.02em] text-foreground">
              {site.stats?.last_activity
                ? formatDistanceToNow(new Date(site.stats.last_activity), {
                    addSuffix: false,
                  })
                : "None"}
            </dd>
            <dt className="text-eyebrow mt-1">Activity</dt>
          </div>
        </dl>

        <div className="mt-5 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onViewDetails(site.id)}
          >
            <Eye aria-hidden="true" />
            View Details
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onEdit(site.id)}
          >
            <Settings aria-hidden="true" />
            Settings
          </Button>
          <ShareButton site={site} variant="icon" className="shrink-0" />
        </div>
      </CardContent>
    </Card>
  );
}
