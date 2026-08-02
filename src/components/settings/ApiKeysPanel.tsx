"use client";

import { useCallback, useEffect, useId, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Key, Trash2, Loader2 } from "lucide-react";
import { useSites } from "@/hooks/useSites";

/**
 * API key management.
 *
 * Keys are issued per site (see /api/api-keys), so the panel is scoped by a
 * site selector rather than showing a single global key. The plaintext secret
 * exists only in the creation response — it is rendered once and never
 * refetched, because the server stores a SHA-256 hash.
 */

interface ApiKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  rate_limit_per_minute: number;
}

async function readError(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: unknown }).error;
    if (typeof message === "string" && message) return message;
  } catch {
    // Non-JSON body — fall back to a status-qualified message.
  }
  return `${fallback} (${response.status})`;
}

export function ApiKeysPanel() {
  const {
    sites,
    selectedSiteId,
    setSelectedSiteId,
    loading: sitesLoading,
  } = useSites();
  const siteSelectId = useId();
  const keyNameId = useId();

  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    if (!selectedSiteId) {
      setKeys([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/api-keys?siteId=${selectedSiteId}`);
      if (!response.ok) {
        throw new Error(await readError(response, "Failed to load API keys"));
      }
      const data: { apiKeys?: ApiKeySummary[] } = await response.json();
      setKeys(data.apiKeys ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!selectedSiteId || !keyName.trim()) return;
    setCreating(true);
    setError(null);
    setRevealedKey(null);
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: selectedSiteId, name: keyName.trim() }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Failed to create API key"));
      }
      const data: { apiKey?: { key?: string } } = await response.json();
      if (typeof data.apiKey?.key === "string") {
        setRevealedKey(data.apiKey.key);
      }
      setKeyName("");
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (apiKeyId: string, name: string) => {
    if (!window.confirm(`Delete the API key "${name}"? This cannot be undone.`))
      return;
    setError(null);
    try {
      const response = await fetch(`/api/api-keys?apiKeyId=${apiKeyId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Failed to delete API key"));
      }
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete API key");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Keys</CardTitle>
        <CardDescription>
          Manage your API keys for programmatic access. Keys are scoped to a
          single site.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p
            role="alert"
            className="text-sm text-tone-danger-text bg-tone-danger-surface border border-tone-danger-border rounded-md px-3 py-2"
          >
            {error}
          </p>
        )}

        {sitesLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sites...
          </div>
        ) : sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Register a site before creating API keys.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor={siteSelectId}>Site</Label>
              <select
                id={siteSelectId}
                value={selectedSiteId}
                onChange={(e) => {
                  setSelectedSiteId(e.target.value);
                  setRevealedKey(null);
                }}
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-transparent"
              >
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name || site.domain}
                  </option>
                ))}
              </select>
            </div>

            {/* Shown exactly once: the server keeps only a hash, so there is no
                way to display this again after the panel re-renders. */}
            {revealedKey && (
              <div className="rounded-lg border border-tone-warning-border bg-tone-warning-surface p-4">
                <p className="mb-2 text-sm font-medium text-tone-warning-text">
                  Copy this key now — it will not be shown again.
                </p>
                <code className="block break-all font-mono text-sm text-foreground">
                  {revealedKey}
                </code>
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading API keys...
              </div>
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No API keys for this site yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {keys.map((apiKey) => (
                  <li
                    key={apiKey.id}
                    className="flex items-center justify-between gap-3 p-4 bg-surface-1 rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{apiKey.name}</p>
                        <Badge
                          className={
                            apiKey.is_active
                              ? "bg-tone-success-surface text-tone-success-text"
                              : "bg-tone-neutral-surface text-tone-neutral-text"
                          }
                        >
                          {apiKey.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <code className="font-mono text-sm text-muted-foreground break-all">
                        {apiKey.key_prefix}…
                      </code>
                      <p className="text-xs text-muted-foreground">
                        {apiKey.rate_limit_per_minute} requests/minute
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete API key ${apiKey.name}`}
                      onClick={() => handleDelete(apiKey.id, apiKey.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor={keyNameId}>New key name</Label>
              <div className="flex gap-2">
                <Input
                  id={keyNameId}
                  placeholder="Production server"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={creating || !keyName.trim() || !selectedSiteId}
                  onClick={handleCreate}
                >
                  <Key className="w-4 h-4 mr-2" />
                  {creating ? "Generating..." : "Generate Key"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Requires admin permission on the selected site.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
