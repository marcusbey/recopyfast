"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Link2,
  Mail,
  CheckCircle2,
  Loader2,
  Eye,
  Edit,
  Upload,
  Shield,
} from "lucide-react";
import { ShareLinkCard, type ShareLink } from "./ShareLinkCard";
import type { Site } from "@/types";

interface ShareSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: Site;
}

type LinkType = "link" | "invite";
type Permission = "view" | "edit" | "publish" | "admin";

const EXPIRY_OPTIONS = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
];

export function ShareSiteDialog({
  open,
  onOpenChange,
  site,
}: ShareSiteDialogProps) {
  const [activeLinks, setActiveLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [linkType, setLinkType] = useState<LinkType>("link");
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([
    "view",
    "edit",
  ]);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [label, setLabel] = useState("");

  const fetchActiveLinks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/staging/access?siteId=${site.id}`);
      const data = await res.json();

      if (data.success && data.accessList) {
        setActiveLinks(data.accessList);
      }
    } catch (err) {
      console.error("Failed to fetch active links:", err);
    } finally {
      setLoading(false);
    }
  }, [site.id]);

  useEffect(() => {
    if (open) {
      fetchActiveLinks();
    }
  }, [open, fetchActiveLinks]);

  const handleCreateLink = async () => {
    if (linkType === "invite" && !email) {
      setError("Email is required for email invites");
      return;
    }

    try {
      setCreating(true);
      setError(null);
      setSuccess(null);

      const res = await fetch("/api/staging/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: site.id,
          type: linkType,
          email: linkType === "invite" ? email : undefined,
          permissions,
          label: label || undefined,
          expiresInDays,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create share link");
      }

      // Copy link to clipboard
      if (data.stagingUrl) {
        await navigator.clipboard.writeText(data.stagingUrl);
        setSuccess("Link created and copied to clipboard!");
      } else {
        setSuccess("Invite sent successfully!");
      }

      // Reset form
      setEmail("");
      setLabel("");
      setPermissions(["view", "edit"]);

      // Refresh list
      await fetchActiveLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link");
    } finally {
      setCreating(false);
    }
  };

  const handleCopyLink = async (link: ShareLink) => {
    const siteUrl = site.domain.startsWith("http")
      ? site.domain
      : `https://${site.domain}`;
    const stagingUrl = `${siteUrl}?rcf_staging=1&rcf_token=${link.token || link.id}`;

    try {
      await navigator.clipboard.writeText(stagingUrl);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleRevokeLink = async (link: ShareLink) => {
    try {
      const res = await fetch(`/api/staging/access?accessId=${link.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setActiveLinks((prev) => prev.filter((l) => l.id !== link.id));
      }
    } catch (err) {
      console.error("Failed to revoke:", err);
    }
  };

  const togglePermission = (perm: Permission) => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share Preview Link</DialogTitle>
          <DialogDescription>
            Create a shareable link for others to preview and collaborate on
            your site.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Link Type Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Link Type</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setLinkType("link")}
                className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                  linkType === "link"
                    ? "border-primary bg-tone-info-surface"
                    : "border-border hover:border-input"
                }`}
              >
                <Link2
                  className={`w-5 h-5 ${linkType === "link" ? "text-tone-info-text" : "text-muted-foreground"}`}
                />
                <span
                  className={`text-sm font-medium ${linkType === "link" ? "text-tone-info-text" : "text-foreground"}`}
                >
                  Anyone with link
                </span>
              </button>
              <button
                type="button"
                onClick={() => setLinkType("invite")}
                className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                  linkType === "invite"
                    ? "border-primary bg-tone-info-surface"
                    : "border-border hover:border-input"
                }`}
              >
                <Mail
                  className={`w-5 h-5 ${linkType === "invite" ? "text-tone-info-text" : "text-muted-foreground"}`}
                />
                <span
                  className={`text-sm font-medium ${linkType === "invite" ? "text-tone-info-text" : "text-foreground"}`}
                >
                  Email invite
                </span>
              </button>
            </div>
          </div>

          {/* Email field for invite type */}
          {linkType === "invite" && (
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="collaborator@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}

          {/* Permissions */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Permissions</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "view" as Permission, icon: Eye, label: "View" },
                { key: "edit" as Permission, icon: Edit, label: "Edit" },
                {
                  key: "publish" as Permission,
                  icon: Upload,
                  label: "Publish",
                },
                { key: "admin" as Permission, icon: Shield, label: "Admin" },
              ].map(({ key, icon: Icon, label: permLabel }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => togglePermission(key)}
                  className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                    permissions.includes(key)
                      ? "border-primary bg-tone-info-surface text-tone-info-text"
                      : "border-border text-muted-foreground hover:border-input"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{permLabel}</span>
                  {permissions.includes(key) && (
                    <CheckCircle2 className="w-4 h-4 ml-auto text-tone-info-text" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Expiry */}
          <div className="space-y-2">
            <Label htmlFor="expiry">Expires in</Label>
            <select
              id="expiry"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Label */}
          <div className="space-y-2">
            <Label htmlFor="label">Label (optional)</Label>
            <Input
              id="label"
              placeholder="e.g., Client review v2"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          {/* Error/Success messages */}
          {error && (
            <div className="p-3 rounded-lg bg-tone-danger-surface text-tone-danger-text text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 rounded-lg bg-tone-success-surface text-tone-success-text text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              {success}
            </div>
          )}

          {/* Create Button */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateLink} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Link"
              )}
            </Button>
          </div>

          {/* Active Links Section */}
          {activeLinks.length > 0 && (
            <div className="border-t border-border pt-6">
              <h3 className="font-medium text-foreground mb-4">Active Links</h3>
              <div className="space-y-3">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  activeLinks.map((link) => (
                    <ShareLinkCard
                      key={link.id}
                      link={link}
                      onCopy={handleCopyLink}
                      onRevoke={handleRevokeLink}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
