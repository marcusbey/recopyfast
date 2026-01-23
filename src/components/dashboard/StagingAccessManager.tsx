"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  Link2,
  Copy,
  Trash2,
  Plus,
  Mail,
  Clock,
  AlertTriangle,
  Check,
  Users,
  Eye,
  Edit3,
  Upload,
  Shield,
  RefreshCw,
  ExternalLink,
} from "lucide-react";

type StagingPermission = "view" | "edit" | "publish" | "admin";

interface StagingAccess {
  id: string;
  access_type: "invite" | "link";
  email: string | null;
  email_verified: boolean;
  token: string;
  permissions: StagingPermission[];
  label: string | null;
  expires_at: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

interface StagingAccessManagerProps {
  siteId: string;
  siteDomain: string;
}

const PERMISSION_INFO: Record<
  StagingPermission,
  { label: string; icon: React.ReactNode; description: string }
> = {
  view: {
    label: "View",
    icon: <Eye className="w-3 h-3" />,
    description: "Can view staging content",
  },
  edit: {
    label: "Edit",
    icon: <Edit3 className="w-3 h-3" />,
    description: "Can edit staging content",
  },
  publish: {
    label: "Publish",
    icon: <Upload className="w-3 h-3" />,
    description: "Can publish to live",
  },
  admin: {
    label: "Admin",
    icon: <Shield className="w-3 h-3" />,
    description: "Full access",
  },
};

export function StagingAccessManager({
  siteId,
  siteDomain,
}: StagingAccessManagerProps) {
  const [accessList, setAccessList] = useState<StagingAccess[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createType, setCreateType] = useState<"invite" | "link">("invite");
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPermissions, setNewPermissions] = useState<StagingPermission[]>([
    "edit",
  ]);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [newStagingUrl, setNewStagingUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAccessList = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/staging/access?siteId=${siteId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch staging access list");
      }

      setAccessList(data.accessList || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    fetchAccessList();
  }, [fetchAccessList]);

  const createAccess = async () => {
    if (createType === "invite" && !newEmail.trim()) {
      setError("Email is required for invitations");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/staging/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          type: createType,
          email: createType === "invite" ? newEmail.trim() : undefined,
          permissions: newPermissions,
          label: newLabel.trim() || undefined,
          expiresInDays,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create staging access");
      }

      setNewStagingUrl(data.stagingUrl);
      setNewEmail("");
      setNewLabel("");
      setShowCreateForm(false);
      await fetchAccessList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const revokeAccess = async (accessId: string) => {
    if (
      !confirm(
        "Are you sure you want to revoke this staging access? This action cannot be undone.",
      )
    ) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(
        `/api/staging/access?siteId=${siteId}&accessId=${accessId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to revoke access");
      }

      await fetchAccessList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStagingUrl = (token: string) => {
    const baseUrl = siteDomain.startsWith("http")
      ? siteDomain
      : `https://${siteDomain}`;
    return `${baseUrl}?rcf_staging=1&rcf_token=${token}`;
  };

  const formatExpiry = (expiresAt: string) => {
    const date = new Date(expiresAt);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (days < 0) return "Expired";
    if (days === 0) return "Expires today";
    if (days === 1) return "Expires tomorrow";
    return `Expires in ${days} days`;
  };

  const togglePermission = (permission: StagingPermission) => {
    if (newPermissions.includes(permission)) {
      setNewPermissions(newPermissions.filter((p) => p !== permission));
    } else {
      setNewPermissions([...newPermissions, permission]);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Staging Access</h2>
          <p className="text-gray-600">
            Manage who can view and edit your staging environment
          </p>
        </div>
        <Button
          onClick={() => setShowCreateForm(true)}
          disabled={loading}
          className="flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Grant Access
        </Button>
      </div>

      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <div className="text-red-800">{error}</div>
        </Alert>
      )}

      {newStagingUrl && (
        <Card className="p-6 bg-green-50 border-green-200">
          <h3 className="text-lg font-semibold text-green-900 mb-4 flex items-center gap-2">
            <Check className="w-5 h-5" />
            Staging Access Created
          </h3>

          <div className="space-y-3">
            <p className="text-green-800">
              Share this URL with the person who needs access:
            </p>
            <div className="flex items-center gap-2 bg-white p-3 rounded border">
              <code className="font-mono text-sm flex-1 break-all">
                {newStagingUrl}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(newStagingUrl, "new")}
                className="flex items-center gap-1 shrink-0"
              >
                {copiedId === "new" ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                {copiedId === "new" ? "Copied!" : "Copy"}
              </Button>
            </div>

            <Alert className="border-blue-200 bg-blue-50">
              <Mail className="h-4 w-4 text-blue-600" />
              <div className="text-blue-800">
                The recipient will need to verify their email before they can
                make edits.
              </div>
            </Alert>
          </div>

          <Button
            onClick={() => setNewStagingUrl(null)}
            variant="outline"
            className="mt-4"
          >
            Close
          </Button>
        </Card>
      )}

      {showCreateForm && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Grant Staging Access</h3>

          <div className="space-y-4">
            {/* Access Type */}
            <div className="flex gap-4">
              <Button
                type="button"
                variant={createType === "invite" ? "default" : "outline"}
                onClick={() => setCreateType("invite")}
                className="flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                Email Invitation
              </Button>
              <Button
                type="button"
                variant={createType === "link" ? "default" : "outline"}
                onClick={() => setCreateType("link")}
                className="flex items-center gap-2"
              >
                <Link2 className="w-4 h-4" />
                Shareable Link
              </Button>
            </div>

            {createType === "invite" && (
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="mt-1"
                />
                <p className="text-sm text-gray-500 mt-1">
                  Only this email can use the staging link.
                </p>
              </div>
            )}

            <div>
              <Label htmlFor="label">Label (optional)</Label>
              <Input
                id="label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={
                  createType === "invite"
                    ? "Marketing Team"
                    : "External Reviewer Link"
                }
                className="mt-1"
              />
              <p className="text-sm text-gray-500 mt-1">
                A friendly name to identify this access.
              </p>
            </div>

            {/* Permissions */}
            <div>
              <Label>Permissions</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                {(
                  Object.entries(PERMISSION_INFO) as [
                    StagingPermission,
                    (typeof PERMISSION_INFO)[StagingPermission],
                  ][]
                ).map(([key, info]) => (
                  <Button
                    key={key}
                    type="button"
                    variant={
                      newPermissions.includes(key) ? "default" : "outline"
                    }
                    onClick={() => togglePermission(key)}
                    className="flex items-center gap-2 justify-start"
                    size="sm"
                  >
                    {info.icon}
                    {info.label}
                  </Button>
                ))}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Select the permissions for this access.
              </p>
            </div>

            {/* Expiry */}
            <div>
              <Label htmlFor="expiry">Expires In</Label>
              <select
                id="expiry"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(parseInt(e.target.value))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              >
                <option value={1}>1 day</option>
                <option value={3}>3 days</option>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={createAccess}
                disabled={
                  loading ||
                  (createType === "invite" && !newEmail.trim()) ||
                  newPermissions.length === 0
                }
                className="flex items-center gap-2"
              >
                {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                {createType === "invite" ? "Send Invitation" : "Create Link"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Access List */}
      <div className="grid gap-4">
        {accessList.length === 0 ? (
          <Card className="p-8 text-center">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">No staging access granted yet.</p>
            <Button
              onClick={() => setShowCreateForm(true)}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Grant First Access
            </Button>
          </Card>
        ) : (
          accessList.map((access) => (
            <Card key={access.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      {access.access_type === "invite" ? (
                        <Mail className="w-4 h-4 text-gray-500" />
                      ) : (
                        <Link2 className="w-4 h-4 text-gray-500" />
                      )}
                      <h3 className="text-lg font-semibold">
                        {access.label || access.email || "Shareable Link"}
                      </h3>
                    </div>

                    <Badge
                      className={
                        access.is_active
                          ? new Date(access.expires_at) > new Date()
                            ? "bg-green-100 text-green-800"
                            : "bg-orange-100 text-orange-800"
                          : "bg-gray-100 text-gray-800"
                      }
                    >
                      {!access.is_active
                        ? "Revoked"
                        : new Date(access.expires_at) > new Date()
                          ? access.email_verified
                            ? "Active"
                            : "Pending Verification"
                          : "Expired"}
                    </Badge>
                  </div>

                  <div className="text-sm text-gray-600 space-y-1">
                    {access.email && (
                      <p className="flex items-center gap-2">
                        <Mail className="w-3 h-3" />
                        {access.email}
                        {access.email_verified && (
                          <Check className="w-3 h-3 text-green-600" />
                        )}
                      </p>
                    )}

                    <p className="flex items-center gap-2">
                      <Clock className="w-3 h-3" />
                      {formatExpiry(access.expires_at)}
                    </p>

                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      {access.permissions.map((perm) => (
                        <Badge
                          key={perm}
                          variant="outline"
                          className="flex items-center gap-1"
                        >
                          {PERMISSION_INFO[perm].icon}
                          {PERMISSION_INFO[perm].label}
                        </Badge>
                      ))}
                    </div>

                    {access.last_used_at && (
                      <p className="text-xs text-gray-400 mt-2">
                        Last used:{" "}
                        {new Date(access.last_used_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copyToClipboard(getStagingUrl(access.token), access.id)
                    }
                    className="flex items-center gap-1"
                  >
                    {copiedId === access.id ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {copiedId === access.id ? "Copied!" : "Copy URL"}
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      window.open(getStagingUrl(access.token), "_blank")
                    }
                    className="flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open
                  </Button>

                  {access.is_active && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => revokeAccess(access.id)}
                      disabled={loading}
                      className="flex items-center gap-1 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-3 h-3" />
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
