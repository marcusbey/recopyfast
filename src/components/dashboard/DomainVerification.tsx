"use client";

import React, { useCallback, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert } from "@/components/ui/alert";
import {
  CheckCircle,
  XCircle,
  Clock,
  Copy,
  Trash2,
  Plus,
  Download,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

/**
 * Shape returned by `GET /api/domains/verify`. The route used to hand back raw
 * `domain_verifications` rows in snake_case while this file read camelCase, so
 * every field rendered `undefined` and `verificationMethod.toUpperCase()` threw
 * the moment a row existed. The route now normalises; this is that contract.
 */
interface DomainVerificationRecord {
  id: string;
  siteId: string;
  domain: string;
  verificationMethod: "dns" | "file";
  verificationCode: string;
  isVerified: boolean;
  verifiedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

interface VerificationInstructions {
  type: "dns" | "file";
  record?: string;
  filename?: string;
  content?: string;
}

interface DomainVerificationProps {
  siteId: string;
  /**
   * The domain already on the site record. Asking an owner to retype a domain
   * the product knows is how the empty form used to get abandoned.
   */
  siteDomain?: string;
}

export function DomainVerification({
  siteId,
  siteDomain,
}: DomainVerificationProps) {
  const [verifications, setVerifications] = useState<
    DomainVerificationRecord[]
  >([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDomain, setNewDomain] = useState(siteDomain ?? "");
  const [verificationMethod, setVerificationMethod] = useState<"dns" | "file">(
    "dns",
  );
  const [instructions, setInstructions] =
    useState<VerificationInstructions | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const fetchVerifications = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/domains/verify?siteId=${siteId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch verifications");
      }

      setVerifications(data.verifications || []);
      setCanManage(Boolean(data.canManage));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void fetchVerifications();
  }, [fetchVerifications]);

  const openAddForm = () => {
    setError(null);
    setNewDomain(siteDomain ?? "");
    setShowAddForm(true);
  };

  const createVerification = async () => {
    // The server sanitises before it validates, and sanitising escapes `/`, so
    // a pasted `https://example.com` never survives to `normalizeDomain` and
    // comes back as "Invalid domain format". Hand it a bare host instead of
    // making the owner work that out.
    const domain = newDomain
      .trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/[/?#].*$/, "");

    if (!domain) {
      setError("Domain is required");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/domains/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          domain,
          method: verificationMethod,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create verification");
      }

      setInstructions(data.instructions);
      setShowAddForm(false);
      await fetchVerifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const verifyDomain = async (verificationId: string) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/domains/verify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationId }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Verification failed");
      }

      await fetchVerifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const deleteVerification = async (verificationId: string) => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `/api/domains/verify?verificationId=${verificationId}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete verification");
      }

      setDeleteTargetId(null);
      await fetchVerifications();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isExpired = (expiresAt: string) => new Date(expiresAt) <= new Date();

  const getStatusBadge = (verification: DomainVerificationRecord) => {
    if (verification.isVerified) {
      return (
        <Badge variant="tone-success" className="gap-1">
          <CheckCircle className="h-3 w-3" aria-hidden="true" />
          Verified
        </Badge>
      );
    }

    if (isExpired(verification.expiresAt)) {
      return (
        <Badge variant="tone-danger" className="gap-1">
          <XCircle className="h-3 w-3" aria-hidden="true" />
          Expired
        </Badge>
      );
    }

    return (
      <Badge variant="tone-warning" className="gap-1">
        <Clock className="h-3 w-3" aria-hidden="true" />
        Awaiting your DNS record
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose">
          <h3 className="text-title">Domain ownership</h3>
          {/*
            The old copy read "Verify domain ownership to enable secure embeds",
            which is not true of this product: the embed script is authorised by
            its signed site token and by the origin it runs on
            (`authorizeSiteRequest`), and nothing in the embed, CORS or content
            path reads `domain_verifications`. Saying otherwise sends owners
            hunting for a blocker that does not exist — which is exactly what
            happened.
          */}
          <p className="mt-1 text-sm text-muted-foreground">
            Record proof that you control this domain, with a DNS TXT record or
            a file on the site. Your embed script does not wait on this — it is
            already authorised by its site token and the origin it runs on.
          </p>
        </div>
        {canManage && (
          <Button
            variant="outline"
            onClick={openAddForm}
            disabled={loading || showAddForm}
          >
            <Plus aria-hidden="true" />
            Add domain
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <div className="text-sm">{error}</div>
        </Alert>
      )}

      {instructions && (
        <Card variant="outline" className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-title">Finish verification</h4>
            <Button
              onClick={() => setInstructions(null)}
              variant="ghost"
              size="sm"
            >
              Dismiss
            </Button>
          </div>

          {instructions.type === "dns" ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-muted-foreground">
                Add this TXT record at the root of your domain&apos;s DNS zone:
              </p>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 p-3">
                <code className="break-all font-mono text-sm text-foreground">
                  {instructions.record}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => copyToClipboard(instructions.record ?? "")}
                >
                  <Copy aria-hidden="true" />
                  Copy
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                DNS can take up to 24 hours to propagate. Come back and press
                Check when the record is live — the challenge itself expires 24
                hours after it was created.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-muted-foreground">
                Upload this file so it is served at{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                  https://{newDomain || "yourdomain.com"}/.well-known/
                  {instructions.filename}
                </code>
              </p>
              <div className="rounded-lg border border-border bg-surface-1 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="break-all font-mono text-sm text-foreground">
                    {instructions.filename}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() =>
                      downloadFile(
                        instructions.filename ?? "verification.txt",
                        instructions.content ?? "",
                      )
                    }
                  >
                    <Download aria-hidden="true" />
                    Download
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded bg-card p-2 text-xs text-foreground">
                  {instructions.content}
                </pre>
              </div>
              <p className="text-sm text-muted-foreground">
                The file must match byte for byte, and the challenge expires 24
                hours after it was created.
              </p>
            </div>
          )}
        </Card>
      )}

      {showAddForm && (
        <Card variant="outline" className="p-5">
          <h4 className="text-title">Add a domain</h4>
          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor="rcf-verification-domain">Domain</Label>
              <Input
                id="rcf-verification-domain"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="example.com"
                className="mt-1"
              />
              {/* `validateDomain` refuses localhost and bare IPs, so say so
                  before the request rather than after a 400. */}
              <p className="mt-1.5 text-xs text-muted-foreground">
                A public domain name. localhost and IP addresses cannot be
                verified — there is nothing external to check.
              </p>
            </div>

            <div>
              <Label>Method</Label>
              <Tabs
                value={verificationMethod}
                onValueChange={(v) =>
                  setVerificationMethod(v as "dns" | "file")
                }
              >
                <TabsList className="mt-1 grid w-full grid-cols-2">
                  <TabsTrigger value="dns">DNS record</TabsTrigger>
                  <TabsTrigger value="file">Hosted file</TabsTrigger>
                </TabsList>
                <TabsContent value="dns" className="mt-3">
                  <p className="text-sm text-muted-foreground">
                    Add a TXT record to your DNS. Best if you control the domain
                    but not the server.
                  </p>
                </TabsContent>
                <TabsContent value="file" className="mt-3">
                  <p className="text-sm text-muted-foreground">
                    Serve a file under <code>/.well-known/</code>. Best if you
                    can deploy to the site but not change DNS.
                  </p>
                </TabsContent>
              </Tabs>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={createVerification}
                disabled={loading || !newDomain.trim()}
              >
                {loading && (
                  <RefreshCw className="animate-spin" aria-hidden="true" />
                )}
                Get instructions
              </Button>
              <Button variant="outline" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {verifications.length === 0 ? (
        !showAddForm && (
          <p className="text-sm text-muted-foreground">
            No ownership proof on record for this site.{" "}
            {canManage
              ? "Nothing is blocked by that — add one only if you want it on file."
              : "Only a site admin can add one."}
          </p>
        )
      ) : (
        <div className="grid gap-3">
          {verifications.map((verification) => {
            const expired = isExpired(verification.expiresAt);

            return (
              <Card key={verification.id} variant="outline" className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h4 className="truncate font-mono text-sm text-foreground">
                        {verification.domain}
                      </h4>
                      {getStatusBadge(verification)}
                      <Badge variant="tone-neutral">
                        {verification.verificationMethod === "dns"
                          ? "DNS"
                          : "File"}
                      </Badge>
                    </div>

                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>
                        Added{" "}
                        {new Date(verification.createdAt).toLocaleDateString()}
                      </p>
                      {verification.isVerified && verification.verifiedAt ? (
                        <p>
                          Verified{" "}
                          {new Date(
                            verification.verifiedAt,
                          ).toLocaleDateString()}
                        </p>
                      ) : (
                        <p>
                          {expired ? "Expired " : "Expires "}
                          {new Date(
                            verification.expiresAt,
                          ).toLocaleDateString()}
                        </p>
                      )}
                    </div>

                    {!verification.isVerified && !expired && (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 p-3">
                        <code className="break-all font-mono text-xs text-foreground">
                          {verification.verificationMethod === "dns"
                            ? `recopyfast-verification=${verification.verificationCode}`
                            : `/.well-known/recopyfast-verification-${verification.verificationCode}.txt`}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          onClick={() =>
                            copyToClipboard(
                              verification.verificationMethod === "dns"
                                ? `recopyfast-verification=${verification.verificationCode}`
                                : verification.verificationCode,
                            )
                          }
                        >
                          <Copy aria-hidden="true" />
                          <span className="sr-only">
                            Copy verification value for {verification.domain}
                          </span>
                        </Button>
                      </div>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 gap-2">
                      {!verification.isVerified && !expired && (
                        <Button
                          size="sm"
                          onClick={() => verifyDomain(verification.id)}
                          disabled={loading}
                        >
                          {loading ? (
                            <RefreshCw
                              className="animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <CheckCircle aria-hidden="true" />
                          )}
                          Check
                        </Button>
                      )}

                      {deleteTargetId === verification.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteVerification(verification.id)}
                            disabled={loading}
                          >
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDeleteTargetId(null)}
                            disabled={loading}
                          >
                            Keep
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleteTargetId(verification.id)}
                          disabled={loading}
                        >
                          <Trash2 aria-hidden="true" />
                          <span className="sr-only">
                            Remove verification for {verification.domain}
                          </span>
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {expired && !verification.isVerified && (
                  <Alert variant="warning" className="mt-4">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    <div className="text-sm">
                      This challenge expired before the record was found. Remove
                      it and add the domain again to get a fresh one.
                    </div>
                  </Alert>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
