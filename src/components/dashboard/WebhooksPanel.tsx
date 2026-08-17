"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Webhook as WebhookIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  StatusBadge,
  webhookDeliveryStatuses,
} from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Webhook, WebhookDelivery, WebhookDeliveryStatus } from "@/types";

/**
 * Webhooks for one site: configure the endpoint, batch window, see what was
 * delivered, send a test.
 *
 * Two pieces of copy here are load-bearing rather than decorative.
 *
 * 1. The batch window's default is restated in words under the control. A
 *    closed `Select` shows its selected value but not that the value IS the
 *    default, and AC 4 asks for the default to be stated.
 * 2. A refusal at configuration time and a refusal at delivery time say
 *    different things. The first is a mistake the owner can correct in the
 *    field above; the second means the endpoint's DNS record now points
 *    somewhere private, which is a different investigation entirely. Rendering
 *    both as "something went wrong" would send them looking at the wrong thing.
 *
 * There is no toast primitive in this design system (documented gap #1), so
 * transient confirmations resolve to an inline `Alert` or a button label swap,
 * the same way ApiKeysPanel already resolves it.
 */

interface WebhooksPanelProps {
  siteId: string;
}

/**
 * Batch-window options.
 *
 * The floor is not cosmetic: dispatch is swept by /api/cron/webhook-dispatch
 * every five minutes (ADR 010), so a window shorter than that tick closes on
 * time but is delivered on the next sweep. The copy below says so rather than
 * implying a 10-second window means a 10-second rebuild.
 */
const WINDOW_OPTIONS = [
  { value: "10", label: "10 seconds" },
  { value: "30", label: "30 seconds (default)" },
  { value: "60", label: "60 seconds" },
  { value: "300", label: "5 minutes" },
] as const;

const DEFAULT_WINDOW = "30";

/** Matches MAX_DELIVERY_ATTEMPTS in the manager; shown as "N of 5". */
const MAX_ATTEMPTS = 5;

interface TestResult {
  success: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
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

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function minutesUntil(value: string): number {
  return Math.max(
    1,
    Math.round((new Date(value).getTime() - Date.now()) / 60000),
  );
}

/** The one line under a delivery row that explains its outcome. */
function deliveryReason(
  delivery: WebhookDelivery,
  windowSeconds: number,
): string {
  switch (delivery.status) {
    case "pending":
      return `Batching — waiting for the ${windowSeconds}-second window to close`;
    case "retrying":
      return delivery.next_retry_at
        ? `— next attempt in ${minutesUntil(delivery.next_retry_at)} min`
        : "— another attempt is scheduled";
    case "failed":
      return (
        delivery.error_message ?? `— gave up after ${MAX_ATTEMPTS} attempts`
      );
    default:
      return "";
  }
}

export function WebhooksPanel({ siteId }: WebhooksPanelProps) {
  const urlFieldId = useId();
  const windowFieldId = useId();

  const [webhook, setWebhook] = useState<Webhook | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const [url, setUrl] = useState("");
  const [windowSeconds, setWindowSeconds] = useState<string>(DEFAULT_WINDOW);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const loadDeliveries = useCallback(async (webhookId: string) => {
    try {
      const response = await fetch(
        `/api/webhooks/deliveries?webhookId=${encodeURIComponent(webhookId)}`,
      );
      if (!response.ok) {
        // A history that cannot be read is not a reason to hide the working
        // configuration above it.
        setDeliveries([]);
        return;
      }
      const data: { deliveries?: WebhookDelivery[] } = await response.json();
      setDeliveries(data.deliveries ?? []);
    } catch {
      setDeliveries([]);
    }
  }, []);

  const loadWebhook = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch(
        `/api/webhooks?siteId=${encodeURIComponent(siteId)}`,
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Failed to load webhooks"));
      }
      const data: Webhook[] = await response.json();
      const configured =
        Array.isArray(data) && data.length > 0 ? data[0] : null;

      setWebhook(configured);
      if (configured) {
        setUrl(configured.url);
        setWindowSeconds(
          String(configured.coalesce_window_seconds ?? DEFAULT_WINDOW),
        );
        await loadDeliveries(configured.id);
      }
    } catch {
      // Error, not empty. The design system rules that empty must never stand
      // in for error: "no webhook configured" and "we could not tell you"
      // demand different actions from the owner.
      setLoadError(true);
      setWebhook(null);
    } finally {
      setLoading(false);
    }
  }, [siteId, loadDeliveries]);

  useEffect(() => {
    loadWebhook();
  }, [loadWebhook]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setTestResult(null);

    try {
      const response = webhook
        ? await fetch("/api/webhooks", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              webhook_id: webhook.id,
              url,
              coalesce_window_seconds: Number(windowSeconds),
            }),
          })
        : await fetch("/api/webhooks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              site_id: siteId,
              url,
              events: ["content.updated"],
              coalesce_window_seconds: Number(windowSeconds),
            }),
          });

      if (!response.ok) {
        throw new Error(await readError(response, "Failed to save webhook"));
      }

      if (!webhook) {
        const data: { webhook?: Webhook; secret?: string } =
          await response.json();
        if (data.webhook) setWebhook(data.webhook);
        // Shown once. There is no second chance to display this, which is why
        // the dialog below refuses every accidental dismissal.
        if (typeof data.secret === "string") setRevealedSecret(data.secret);
        setIsAdding(false);
      }

      await loadWebhook();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save webhook",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!webhook) return;
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/webhooks/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhook_id: webhook.id }),
      });
      if (!response.ok) {
        setTestResult({
          success: false,
          error: await readError(response, "Test delivery failed"),
        });
        return;
      }
      setTestResult((await response.json()) as TestResult);
      await loadDeliveries(webhook.id);
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : "Test delivery failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleCopySecret = async () => {
    if (!revealedSecret) return;
    try {
      await navigator.clipboard.writeText(revealedSecret);
      setCopied(true);
    } catch {
      // Clipboard permission refused — the value is on screen to select by hand.
      setCopied(false);
    }
  };

  const showForm = Boolean(webhook) || isAdding;

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <IconTile tone="accent">
            <WebhookIcon aria-hidden="true" />
          </IconTile>
          <div>
            <h3 className="text-title">Webhooks</h3>
            <p className="text-sm text-muted-foreground">
              Call an endpoint on your build system whenever this site&apos;s
              content changes.
            </p>
          </div>
        </div>

        {loading ? (
          <div
            className="space-y-3"
            aria-label="Loading webhooks"
            role="status"
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load webhook settings</AlertTitle>
            <AlertDescription>
              Something went wrong fetching this site&apos;s webhook
              configuration. Reload the page to try again.
            </AlertDescription>
          </Alert>
        ) : !showForm ? (
          <EmptyState
            icon={WebhookIcon}
            title="No webhook yet"
            description="No webhook configured for this site. Add one to trigger a rebuild whenever content changes."
            action={
              <Button onClick={() => setIsAdding(true)}>Add webhook</Button>
            }
          />
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor={urlFieldId}>Webhook URL</Label>
              <Input
                id={urlFieldId}
                className="font-mono"
                placeholder="https://api.example.com/rebuild"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
              {saveError && (
                <Alert variant="destructive">
                  <AlertTitle>This address can&apos;t be used</AlertTitle>
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor={windowFieldId}>Batch window</Label>
              <Select value={windowSeconds} onValueChange={setWindowSeconds}>
                <SelectTrigger id={windowFieldId} aria-label="Batch window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Edits made within this window are grouped into one delivery, so
                a burst of changes doesn&apos;t trigger a burst of rebuilds.
                Default: 30 seconds. Deliveries are dispatched by a job that
                runs every five minutes, so a window shorter than that is
                delivered on the next run.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={saving || !url.trim()}>
                {webhook ? "Update" : "Save"}
              </Button>
              {webhook && (
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={testing}
                >
                  {testing ? "Sending…" : "Send test delivery"}
                </Button>
              )}
            </div>

            {testResult && (
              <Alert variant={testResult.success ? "success" : "destructive"}>
                <AlertTitle>
                  {testResult.success
                    ? "Test delivery sent"
                    : "Test delivery failed"}
                </AlertTitle>
                <AlertDescription>
                  {testResult.success ? (
                    <span>
                      Received a{" "}
                      <span className="font-mono">{testResult.statusCode}</span>{" "}
                      response in{" "}
                      <span className="tabular">{testResult.responseTime}</span>{" "}
                      ms.
                    </span>
                  ) : (
                    testResult.error
                  )}
                </AlertDescription>
              </Alert>
            )}

            {webhook && (
              <div className="space-y-2">
                <p className="text-eyebrow">Recent deliveries</p>
                {deliveries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No deliveries yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {deliveries.map((delivery) => {
                      const definition =
                        webhookDeliveryStatuses[
                          delivery.status as WebhookDeliveryStatus
                        ] ?? webhookDeliveryStatuses.pending;

                      return (
                        <li
                          key={delivery.id}
                          className="rounded-lg bg-surface-1 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={definition} />
                            <span className="font-mono text-xs text-muted-foreground">
                              {delivery.response_status ?? "—"}
                            </span>
                            <span className="tabular text-xs text-muted-foreground">
                              {formatTimestamp(delivery.delivered_at)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {delivery.status !== "pending" && (
                              <>
                                Attempt{" "}
                                <span className="tabular">
                                  {delivery.attempt_number} of {MAX_ATTEMPTS}
                                </span>{" "}
                              </>
                            )}
                            {deliveryReason(
                              delivery,
                              webhook.coalesce_window_seconds ??
                                Number(DEFAULT_WINDOW),
                            )}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Show-once. No corner X, no overlay click, no Escape: the value behind
          this dialog cannot be recovered, so every accidental dismissal costs
          the owner a delete-and-recreate. */}
      <Dialog open={revealedSecret !== null}>
        <DialogContent
          showClose={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogTitle>Your webhook signing secret</DialogTitle>
          <DialogDescription>
            Use this to verify that a delivery really came from RecopyFast.
          </DialogDescription>
          <Alert variant="warning">
            <AlertTitle>This is shown once</AlertTitle>
            <AlertDescription>
              Copy it now and store it somewhere safe. It is never displayed
              again — if you lose it, create a new webhook.
            </AlertDescription>
          </Alert>
          <code className="block break-all rounded-md bg-surface-1 p-3 font-mono text-sm">
            {revealedSecret}
          </code>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={handleCopySecret}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              onClick={() => {
                setRevealedSecret(null);
                setCopied(false);
              }}
            >
              Done — I&apos;ve saved it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
