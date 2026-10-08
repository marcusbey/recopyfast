"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ArrowUpRight,
  Globe,
  MoreVertical,
  PencilLine,
  Share2,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconTile } from "@/components/ui/icon-tile";
import {
  StatusBadge,
  resolveSiteStatus,
  siteStatuses,
  type SiteStatus,
} from "@/components/ui/status-badge";
import { useEditSession } from "@/hooks/useEditSession";
import EditWebsiteButton from "./EditWebsiteButton";
import { sitePageHref } from "./site/SiteSubnav";
import { OWNER_EDIT_PERMISSIONS } from "./site/useSitePageShell";

/**
 * One site on the Sites list (s66c1 AC 3). It replaces `SiteCard`.
 *
 * The card carried seven controls: View Details, a "Settings" button that in
 * fact started an edit session through a dialog, a share icon, three figures
 * (one, views, never computed), and two hover-only controls — copy domain,
 * and the ⋮ that held the only Delete, which a touch screen cannot reach. A
 * row holds three, all visible at rest:
 * - the name, a link to the site's own page (ADR 052);
 * - one primary action, by status: "Continue setup" while the site awaits
 *   install (to its Overview, where the snippet is), "Edit website" once it
 *   reports;
 * - ⋮: Open site page, Edit website, Share preview link, Delete site.
 *
 * There is no `Table` primitive (design-system gap 8): the list is a `<ul>` of
 * ruled rows in one bordered panel. At 768 and up a row is one line; below,
 * the name and ⋮ share the first line and the rest stacks under the name.
 */

export interface SiteRowSite {
  id: string;
  domain: string;
  name: string;
  updated_at?: string;
  status?: SiteStatus;
}

interface SiteRowProps {
  site: SiteRowSite;
  /** Opens the shared delete confirmation. Nothing is deleted here. */
  onDelete: (siteId: string) => void;
  onShare: (siteId: string) => void;
}

const ROW_GRID = [
  "grid min-h-16 items-center gap-x-3 gap-y-2 px-4 py-3",
  "grid-cols-[2.25rem_minmax(0,1fr)_2rem]",
  "[grid-template-areas:'tile_id_menu'_'._status_status'_'._action_action'_'._error_error']",
  "md:gap-x-4",
  "md:grid-cols-[2.25rem_minmax(0,1.4fr)_minmax(0,1fr)_auto_2rem]",
  "md:[grid-template-areas:'tile_id_status_action_menu'_'._error_error_error_error']",
].join(" ");

export function SiteRow({ site, onDelete, onShare }: SiteRowProps) {
  const { openEditSession } = useEditSession(site.domain);
  const [editError, setEditError] = useState<string | null>(null);
  // An unknown status resolves to "awaiting install", the state that claims
  // nothing (status-badge.tsx); the primary action follows the same rule.
  const definition = resolveSiteStatus(site.status);
  const isAwaitingInstall = definition === siteStatuses["awaiting-install"];
  const sitePage = sitePageHref(site.id);

  const lastEdited = site.updated_at
    ? formatDistanceToNow(new Date(site.updated_at), { addSuffix: true })
    : "Never";

  // The menu's Edit website: the same hook and the same body as the row's
  // button, and the tab opens on this select, inside the user's activation.
  const startEdit = async () => {
    setEditError(null);
    const message = await openEditSession({
      siteId: site.id,
      permissions: OWNER_EDIT_PERMISSIONS,
      durationHours: 2,
    });
    if (message) setEditError(message);
  };

  return (
    <li className={ROW_GRID}>
      <IconTile className="[grid-area:tile]">
        <Globe aria-hidden="true" />
      </IconTile>

      <div className="min-w-0 [grid-area:id]">
        <Link
          href={sitePage}
          className="block truncate rounded-control font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {site.name}
        </Link>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {site.domain}
        </p>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 [grid-area:status]">
        <StatusBadge status={definition} />
        <span className="text-xs text-muted-foreground">
          Last edited {lastEdited}
        </span>
      </div>

      <div className="min-w-0 [grid-area:action] md:justify-self-end">
        {isAwaitingInstall ? (
          <Button asChild variant="outline" size="sm">
            <Link href={sitePage}>Continue setup</Link>
          </Button>
        ) : (
          <EditWebsiteButton
            site={site}
            userPermissions={OWNER_EDIT_PERMISSIONS}
            variant="outline"
            size="sm"
            aria-label={`Edit website: ${site.name}`}
          />
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Open menu for ${site.name}`}
            className="[grid-area:menu]"
          >
            <MoreVertical aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link href={sitePage} className="gap-2">
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              Open site page
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onSelect={() => void startEdit()}>
            <PencilLine className="h-4 w-4" aria-hidden="true" />
            Edit website
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onSelect={() => onShare(site.id)}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Share preview link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-tone-danger-text focus:text-tone-danger-text"
            onSelect={() => onDelete(site.id)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete site
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editError && (
        <Alert variant="destructive" className="[grid-area:error]">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{editError}</AlertDescription>
        </Alert>
      )}
    </li>
  );
}
