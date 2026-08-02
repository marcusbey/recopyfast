"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Link2,
  Copy,
  CheckCircle2,
  Trash2,
  Eye,
  Edit,
  Upload,
  Shield,
  Mail,
} from "lucide-react";
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
  stagingUrl?: string;
  token?: string;
}

interface ShareLinkCardProps {
  link: ShareLink;
  onCopy: (link: ShareLink) => void;
  onRevoke: (link: ShareLink) => void;
}

const permissionIcons = {
  view: Eye,
  edit: Edit,
  publish: Upload,
  admin: Shield,
};

export function ShareLinkCard({ link, onCopy, onRevoke }: ShareLinkCardProps) {
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const handleCopy = async () => {
    onCopy(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async () => {
    setRevoking(true);
    await onRevoke(link);
    setRevoking(false);
  };

  const isExpired = new Date(link.expiresAt) < new Date();
  const expiresText = isExpired
    ? "Expired"
    : `Expires ${format(new Date(link.expiresAt), "MMM d")}`;

  return (
    <div className="bg-surface-1 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-full bg-tone-info-surface flex items-center justify-center flex-shrink-0">
            {link.type === "invite" ? (
              <Mail className="w-4 h-4 text-tone-info-text" />
            ) : (
              <Link2 className="w-4 h-4 text-tone-info-text" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground truncate">
              {link.label || link.email || "Shareable link"}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground">
                {expiresText}
              </span>
              {link.email && !link.emailVerified && (
                <Badge
                  variant="outline"
                  className="text-xs bg-tone-warning-surface text-tone-warning-text border-tone-warning-border"
                >
                  Pending
                </Badge>
              )}
              {isExpired && (
                <Badge
                  variant="outline"
                  className="text-xs bg-tone-danger-surface text-tone-danger-text border-tone-danger-border"
                >
                  Expired
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            disabled={isExpired}
            aria-label={copied ? "Share link copied" : "Copy share link"}
            className="h-8 px-2"
          >
            {copied ? (
              <CheckCircle2 className="w-4 h-4 text-tone-success-text" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRevoke}
            disabled={revoking}
            aria-label="Revoke this share"
            className="h-8 px-2 text-tone-danger-text hover:text-tone-danger-text hover:bg-tone-danger-surface"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {link.permissions.map((perm) => {
          const Icon = permissionIcons[perm];
          return (
            <Badge
              key={perm}
              variant="outline"
              className="text-xs bg-card border-border text-muted-foreground"
            >
              <Icon className="w-3 h-3 mr-1" />
              {perm.charAt(0).toUpperCase() + perm.slice(1)}
            </Badge>
          );
        })}
      </div>

      {link.lastUsedAt && (
        <p className="text-xs text-muted-foreground mt-2">
          Last used{" "}
          {formatDistanceToNow(new Date(link.lastUsedAt), { addSuffix: true })}
        </p>
      )}
    </div>
  );
}
