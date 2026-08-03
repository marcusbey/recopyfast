"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, Edit, Upload, Shield, Trash2, Mail } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils/cn";
import type { EditorPermission } from "@/lib/auth/editor-access";

/**
 * One row of the site's durable editor allowlist.
 *
 * Keyed by email rather than by a user id, because an editor is usually a
 * client's marketing contact with no ReCopyFast account — there is no user
 * record to point at, and there never will be.
 */
export interface SiteEditorSummary {
  id: string;
  email: string;
  permissions: EditorPermission[];
  createdAt: string;
  revokedAt: string | null;
  activeDevices: number;
}

interface SiteEditorRowProps {
  editor: SiteEditorSummary;
  /** Opens the confirmation step. Nothing is destroyed by this callback. */
  onRevoke: (editor: SiteEditorSummary) => void;
}

const permissionIcons: Record<EditorPermission, LucideIcon> = {
  view: Eye,
  edit: Edit,
  publish: Upload,
  admin: Shield,
};

/**
 * The device count is the only visible sign of what a removal will destroy, so
 * it is spelled out rather than shown as a bare number.
 */
function describeDevices(count: number): string {
  if (count === 0) return "No devices signed in";
  return count === 1 ? "1 device signed in" : `${count} devices signed in`;
}

export function SiteEditorRow({ editor, onRevoke }: SiteEditorRowProps) {
  const { revokedAt } = editor;
  const isRevoked = revokedAt !== null;

  const detail = isRevoked
    ? `Removed ${formatDistanceToNow(new Date(revokedAt), { addSuffix: true })}`
    : `${describeDevices(editor.activeDevices)} · Added ${formatDistanceToNow(
        new Date(editor.createdAt),
        { addSuffix: true },
      )}`;

  return (
    <li
      className={cn(
        "rounded-lg border border-border bg-surface-1 p-4",
        isRevoked && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tone-info-surface">
            <Mail className="h-4 w-4 text-tone-info-text" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium text-foreground">
                {editor.email}
              </p>
              {isRevoked && <Badge variant="tone-neutral">Removed</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </div>
        </div>

        {/* A removed editor has nothing left to remove. Re-inviting the same
            address through the form above is what restores them. */}
        {!isRevoked && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRevoke(editor)}
            aria-label={`Remove ${editor.email}`}
            className="h-8 px-2 text-tone-danger-text hover:bg-tone-danger-surface hover:text-tone-danger-text"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editor.permissions.map((permission) => {
          const Icon = permissionIcons[permission];
          return (
            <Badge key={permission} variant="outline">
              <Icon className="mr-1 h-3 w-3" aria-hidden="true" />
              {permission.charAt(0).toUpperCase() + permission.slice(1)}
            </Badge>
          );
        })}
      </div>
    </li>
  );
}
