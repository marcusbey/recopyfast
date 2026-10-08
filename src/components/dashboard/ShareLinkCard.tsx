"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/ui/icon-tile";
import { Link2, Trash2, Eye, Edit, Upload, Shield, Mail } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

export interface ShareLink {
  id: string;
  type: "invite" | "link";
  email: string | null;
  emailVerified: boolean;
  permissions: ("view" | "edit" | "publish" | "admin")[];
  label: string | null;
  expiresAt: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/**
 * One listed preview link: who it is for, when it expires, what it grants,
 * and Revoke.
 *
 * No Copy (PR #72 review, D2). A listed link has no secret token:
 * `GET /api/staging/access` leaves it out on purpose, and the `token` and
 * `stagingUrl` fields this type used to declare were never filled. The copy
 * action rebuilt the URL from the row id, so every link copied from a list
 * opened a preview that refused it. A link is copied once, from the creation
 * response, in `ShareSiteDialog`.
 */
interface ShareLinkCardProps {
  link: ShareLink;
  onRevoke: (link: ShareLink) => void;
}

const permissionIcons = {
  view: Eye,
  edit: Edit,
  publish: Upload,
  admin: Shield,
};

export function ShareLinkCard({ link, onRevoke }: ShareLinkCardProps) {
  const [revoking, setRevoking] = useState(false);

  const handleRevoke = async () => {
    setRevoking(true);
    await onRevoke(link);
    setRevoking(false);
  };

  const isExpired = new Date(link.expiresAt) < new Date();
  const expiresText = isExpired
    ? "Expired"
    : `Expires ${format(new Date(link.expiresAt), "MMM d")}`;

  // s66a, design § 2. At 375px this card's row could not shrink inside the
  // dialog's grid track, which is what gave the Share dialog its horizontal
  // scrollbar (s66 research, fact 1). Every text column is `min-w-0`, the label
  // truncates, and the meta and permission rows wrap instead of pushing.
  return (
    <div className="rounded-container border border-border bg-surface-1 p-3">
      <div className="flex items-start gap-3">
        <IconTile tone="info" size="sm">
          {link.type === "invite" ? <Mail /> : <Link2 />}
        </IconTile>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {link.label || link.email || "Shareable link"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs text-muted-foreground">{expiresText}</span>
            {link.email && !link.emailVerified && (
              <Badge variant="tone-warning" size="sm">
                Pending
              </Badge>
            )}
            {isExpired && (
              <Badge variant="tone-danger" size="sm">
                Expired
              </Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleRevoke}
            disabled={revoking}
            aria-label="Revoke this share"
            className="text-tone-danger-text hover:bg-tone-danger-surface hover:text-tone-danger-text"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {link.permissions.map((perm) => {
          const Icon = permissionIcons[perm];
          return (
            <Badge
              key={perm}
              variant="outline"
              className="bg-card text-muted-foreground"
            >
              <Icon className="mr-1 h-3 w-3" aria-hidden="true" />
              {perm.charAt(0).toUpperCase() + perm.slice(1)}
            </Badge>
          );
        })}
      </div>

      {link.lastUsedAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last used{" "}
          {formatDistanceToNow(new Date(link.lastUsedAt), { addSuffix: true })}
        </p>
      )}
    </div>
  );
}
