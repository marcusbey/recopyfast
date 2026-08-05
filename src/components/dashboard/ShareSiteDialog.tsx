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
import { CheckCircle2, Loader2, Eye, Edit, Upload, Shield } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ShareLinkCard, type ShareLink } from "./ShareLinkCard";
import type { Site } from "@/types";

interface ShareSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: Site;
}

type Permission = "view" | "edit" | "publish" | "admin";

const EXPIRY_OPTIONS = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
];

const PERMISSION_OPTIONS: ReadonlyArray<{
  key: Permission;
  icon: LucideIcon;
  label: string;
}> = [
  { key: "view", icon: Eye, label: "View" },
  { key: "edit", icon: Edit, label: "Edit" },
  { key: "publish", icon: Upload, label: "Publish" },
  { key: "admin", icon: Shield, label: "Admin" },
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

  // Form state.
  // Anonymous "Anyone with link" sharing was retired — a database trigger
  // rejects those rows — so email invite is the only access type this dialog
  // can create. There is no `linkType` toggle any more; every submission
  // sends type "invite".
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
      setError(null);
      const res = await fetch(`/api/staging/access?siteId=${site.id}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        // Swallowing this left the dialog showing "no active links" when the
        // request had actually failed, hiding shares that do exist.
        throw new Error(data.error || `Failed to load shares (${res.status})`);
      }

      setActiveLinks(data.accessList ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load active shares",
      );
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
    if (!email) {
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
          type: "invite",
          email,
          permissions,
          label: label || undefined,
          expiresInDays,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create share link");
      }

      // The invite is worthless without its emailed verification code, so say
      // plainly when the mail did not go out rather than reporting a success
      // the recipient will never see. `emailDelivered` is undefined on
      // responses that sent no mail at all.
      if (data.emailDelivered === false) {
        setError(
          "Invite created, but the verification email could not be sent. " +
            "The recipient cannot get in until it is resent — check the email " +
            "provider configuration.",
        );
      } else if (data.stagingUrl) {
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
          {/* Email invite is the only access type this dialog creates.
              "Anyone with link" sharing was retired — StagingAccessManager
              .createStagingAccess throws for it and the database rejects the
              row — so the Link Type toggle that used to offer it (and always
              failed) has been removed in favor of a single invite form. */}
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

          {/* Permissions.
              These were bare <button>s whose only state signal was a colour
              swap, so nothing announced them as toggles and nothing said which
              ones were on. They are a checkbox group rather than the radiogroup
              used in UpgradeDialog and ThemePicker because several permissions
              hold at once — the default grant is view + edit — and radio
              semantics would tell a screen reader the opposite, that choosing
              one clears the others. A checkbox group is also the pattern that
              needs no roving tabindex: every option stays in the tab order, and
              a native <button> already answers Space and Enter, which is the
              whole keyboard contract for role="checkbox". */}
          <div className="space-y-3">
            <Label id="share-permissions-label" className="text-sm font-medium">
              Permissions
            </Label>
            <div
              role="group"
              aria-labelledby="share-permissions-label"
              className="grid grid-cols-2 gap-2"
            >
              {PERMISSION_OPTIONS.map(
                ({ key, icon: Icon, label: permLabel }) => {
                  const isGranted = permissions.includes(key);

                  return (
                    <button
                      key={key}
                      type="button"
                      role="checkbox"
                      aria-checked={isGranted}
                      onClick={() => togglePermission(key)}
                      className={`flex items-center gap-2 p-2 rounded-lg border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        isGranted
                          ? "border-primary bg-tone-info-surface text-tone-info-text"
                          : "border-border text-muted-foreground hover:border-input"
                      }`}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      <span className="text-sm font-medium">{permLabel}</span>
                      {/* Carries WCAG 1.4.1 on its own: the granted option is
                          the only one wearing a tick, so the state survives
                          when the teal border and surface do not read as
                          different. */}
                      {isGranted && (
                        <CheckCircle2
                          className="w-4 h-4 ml-auto text-tone-info-text"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                },
              )}
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

          {/* Active Links Section.
              The loading branch used to be nested inside `activeLinks.length > 0`,
              so it could only render when the list was already populated — i.e.
              never on first open. The spinner now gates the section itself. */}
          {(loading || activeLinks.length > 0) && (
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
