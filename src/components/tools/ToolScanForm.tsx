"use client";

import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { track } from "@/lib/analytics/google-analytics/gtag";
import { trackToolGoal } from "@/lib/analytics/datafast-client";

/**
 * The scan form on every scanning tool page (s96).
 *
 * - On success the browser ENTERS the report with `window.location.assign`,
 *   a new document: the report runs under the nonce CSP (ADR 062), and the
 *   policy belongs to the document, so a client-side route change would keep
 *   this static page's `'unsafe-inline'` policy (architecture.md § CSP). Only
 *   a same-origin `/tools/<this tool>/r/<uuid>` path is followed; anything else
 *   the server returned is ignored.
 * - Every refusal (400/403/415/422/429/503) shows the server's fixed message
 *   in a destructive Alert. A failure never falls through to an empty or
 *   "nothing found" state.
 * - The address is checked by the server, not by the browser: `type="url"`
 *   gives phones the right keyboard, `noValidate` lets "example.com" through.
 */

const REPORT_PATH =
  /^\/tools\/([a-z0-9][a-z0-9-]{0,62})\/r\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const FALLBACK_ERROR =
  "The scan didn't complete. Please try again in a moment.";

export function isReportPathFor(tool: string, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = REPORT_PATH.exec(value);
  return match !== null && match[1] === tool;
}

function messageFrom(body: unknown): string {
  if (body && typeof body === "object") {
    const { message, error } = body as { message?: unknown; error?: unknown };
    if (typeof message === "string" && message) return message;
    if (typeof error === "string" && error) return error;
  }
  return FALLBACK_ERROR;
}

/** A new document, never a client-side route change (see the header). */
function enterDocument(url: string): void {
  window.location.assign(url);
}

export function ToolScanForm({
  tool,
  submitLabel,
  navigate = enterDocument,
}: {
  tool: string;
  submitLabel: string;
  /** Tests observe navigation through this; pages never pass it. */
  navigate?: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isScanning) return;
    setError(null);
    setIsScanning(true);

    let response: Response;
    let body: unknown = null;
    try {
      response = await fetch("/api/tools/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, url }),
      });
      body = await response.json().catch(() => null);
    } catch {
      setIsScanning(false);
      setError(FALLBACK_ERROR);
      return;
    }

    const reportUrl = (body as { reportUrl?: unknown } | null)?.reportUrl;
    if (response.ok && isReportPathFor(tool, reportUrl)) {
      // s107: the scan is measured here, on the tool page (marketing CSP,
      // on the analytics allowlist), never on the report it opens: reports
      // are capability URLs under the nonce policy and carry no analytics
      // (ADR 063). Slug only; never the scanned address. A no-op unless GA
      // runs on this page. gtag.js sends queued events with `sendBeacon` as
      // the page is left, so the navigation below does not lose it.
      track("tool_scan_completed", { tool_slug: tool });
      // DataFast (ADR 074): the tool's goal, never the scanned address.
      trackToolGoal(tool);
      navigate(reportUrl);
      return;
    }
    setIsScanning(false);
    setError(response.ok ? FALLBACK_ERROR : messageFrom(body));
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <Label
        htmlFor="tool-scan-url"
        className="text-base font-semibold text-slate-900"
      >
        Website address
      </Label>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Input
          id="tool-scan-url"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          required
          placeholder="example.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-describedby="tool-scan-hint"
          disabled={isScanning}
          className="sm:flex-1"
        />
        <Button type="submit" disabled={isScanning || url.trim() === ""}>
          {isScanning ? "Scanning…" : submitLabel}
        </Button>
      </div>
      <p id="tool-scan-hint" className="mt-3 text-sm text-slate-600">
        We read your homepage and up to nine more public pages. Anything after a
        ? or # in the address is left out, so links with tokens stay private.
      </p>

      <div role="status" aria-live="polite" className="mt-4">
        {isScanning ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              Scanning your pages. This can take up to 20 seconds.
            </p>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
