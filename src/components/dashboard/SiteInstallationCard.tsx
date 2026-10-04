"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Copy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import {
  StatusBadge,
  resolveSiteStatus,
  type SiteStatus,
} from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { installRecipes } from "@/lib/sites/install-recipes";
import type { StableEmbedInstallation } from "@/lib/sites/embed-script";

/**
 * The one place a site's install state is shown.
 *
 * It replaces two surfaces that answered the same question in different words:
 * the header status pill, and an "Integration Status" card whose "Script
 * Installation" and "API Connection" rows were both derived from the same
 * `content_elements` count. An owner reading two verdicts on one fact has to
 * decide which to believe, and the two did not even use the same vocabulary.
 *
 * ONE ANATOMY, FOUR STATES. Header (glyph, title, pill) never moves; only the
 * tone and the body change. That sameness is what makes the flip legible — the
 * owner is watching one shape change, not being handed a different screen.
 *
 * Purely presentational. The status and generated installation arrive already
 * resolved from
 * `GET /api/sites`, which calls `resolveEffectiveSiteStatus` once per site;
 * nothing here recomputes the staleness window, and nothing here gates
 * anything on it (AC 7).
 */

export interface SiteInstallationCardSite {
  id: string;
  domain: string;
  status?: SiteStatus;
  live_at?: string | null;
  last_reported_at?: string | null;
  last_mismatch_domain?: string | null;
  embedScript?: string;
  siteToken?: string;
  installation?: StableEmbedInstallation;
}

interface SiteInstallationCardProps {
  site: SiteInstallationCardSite;
}

/** How long the copy button keeps saying "Copied". */
const COPY_CONFIRMATION_MS = 2000;

function relativeTime(value?: string | null): string | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return formatDistanceToNow(parsed, { addSuffix: true });
}

interface InstallationProps {
  installation: StableEmbedInstallation;
}

/**
 * The two generated placements and their copy controls.
 *
 * The design system has no toast or transient-feedback primitive (its own gap
 * #1), so confirmation and failure stay inline beside code that remains
 * selectable. The owner knows which placement copied without losing the manual
 * fallback when clipboard permission is denied.
 */
export function StableInstallationSnippets({
  installation,
}: InstallationProps) {
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const handleCopy = async (value: string, label: string) => {
    setNotice(null);
    try {
      await navigator.clipboard.writeText(value);
      const message = `${label} copied`;
      setNotice({ kind: "success", message });
      setTimeout(() => {
        setNotice((current) => (current?.message === message ? null : current));
      }, COPY_CONFIRMATION_MS);
    } catch {
      setNotice({
        kind: "error",
        message: `Could not copy the ${label.toLowerCase()}. Select it manually.`,
      });
    }
  };

  const placements = [
    {
      label: "Head bootstrap",
      value: installation.headBootstrap,
      help: "Place this native inline script in <head>, before any body content exists.",
    },
    {
      label: "Runtime tag",
      value: installation.runtimeTag,
      help: "Load this external script at the platform's body or hydration-safe runtime point.",
    },
  ] as const;

  return (
    <div className="space-y-4">
      {notice && (
        <Alert variant={notice.kind === "error" ? "destructive" : "success"}>
          {notice.kind === "success" && (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          )}
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      )}
      {placements.map((placement) => (
        <section key={placement.label} className="space-y-2">
          <div>
            <p className="text-sm font-medium text-foreground">
              {placement.label}
            </p>
            <p className="text-sm text-muted-foreground">{placement.help}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <code className="break-all font-mono text-sm text-foreground">
              {placement.value}
            </code>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCopy(placement.value, placement.label)}
          >
            <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
            Copy {placement.label.toLowerCase()}
          </Button>
        </section>
      ))}
    </div>
  );
}

/** The `awaiting-install` body: where the snippet goes, per stack (AC 5). */
export function StableInstallationInstructions({
  installation,
}: InstallationProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Add both generated placements to your site
      </p>
      <Tabs defaultValue={installRecipes[0].id}>
        <TabsList>
          {installRecipes.map((recipe) => (
            <TabsTrigger key={recipe.id} value={recipe.id}>
              {recipe.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {installRecipes.map((recipe) => (
          <TabsContent key={recipe.id} value={recipe.id} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Head:</span>{" "}
              {recipe.headLocation}
            </p>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Runtime:</span>{" "}
              {recipe.runtimeLocation}
            </p>
            {recipe.notes && (
              <p className="text-sm text-muted-foreground">{recipe.notes}</p>
            )}
            <StableInstallationSnippets installation={installation} />
          </TabsContent>
        ))}
      </Tabs>
      <Alert variant="info">
        <AlertTitle>Existing installs need both placements</AlertTitle>
        <AlertDescription>
          The old single tag keeps working, but it cannot protect text that
          painted before it loaded. Replace it with this head bootstrap and
          runtime tag to use stable initial copy.
        </AlertDescription>
      </Alert>
      <Alert variant="info">
        <AlertTitle>Safe fallback</AlertTitle>
        <AlertDescription>
          If the head bootstrap is late or blocked by Content Security Policy,
          visitors keep the page&apos;s authored text. ReCopyFast will not apply
          a late public startup swap on that page load.
        </AlertDescription>
      </Alert>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Restrictive CSP: add <code>{`'${installation.csp.scriptHash}'`}</code>{" "}
          to script-src and <code>{`'${installation.csp.styleHash}'`}</code> to
          style-src.
        </p>
        <p>
          Allow the external runtime from{" "}
          <code>{installation.csp.scriptSource}</code>. Do not enable
          unsafe-inline.
        </p>
      </div>
    </div>
  );
}

/** `live` and `stale` lead with the state; the snippet is one click away. */
function SnippetDisclosure({ installation }: InstallationProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="link" size="sm" onClick={() => setOpen(true)}>
        View installation code
      </Button>
    );
  }

  return <StableInstallationSnippets installation={installation} />;
}

export function SiteInstallationCard({ site }: SiteInstallationCardProps) {
  const status = site.status ?? "awaiting-install";
  const definition = resolveSiteStatus(status);
  const Glyph = definition.icon;
  const installation = site.installation;

  const liveSince = relativeTime(site.live_at);
  const lastReport = relativeTime(site.last_reported_at);

  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconTile tone={definition.tone}>
              <Glyph />
            </IconTile>
            <p className="text-xl font-semibold leading-tight tracking-[-0.014em]">
              Installation
            </p>
          </div>
          <StatusBadge status={definition} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/*
          A mismatch never verifies the site, so it is not a fourth state — it
          is `awaiting-install` with the one fact that explains why. Warning,
          not destructive: nothing is broken, the snippet is on the wrong page.
        */}
        {status === "awaiting-install" && site.last_mismatch_domain && (
          <Alert variant="warning">
            <AlertTitle>Report from an unregistered domain</AlertTitle>
            <AlertDescription>
              We received a report from {site.last_mismatch_domain}, not{" "}
              {site.domain}. This site stays awaiting install until we see it
              from the registered domain — check you pasted the snippet on the
              right site.
            </AlertDescription>
          </Alert>
        )}

        {status === "awaiting-install" && installation && (
          <>
            <StableInstallationInstructions installation={installation} />
            <Alert variant="info">
              <AlertTitle>Checking automatically</AlertTitle>
              <AlertDescription>
                This card updates itself within 10 seconds of the first page
                view on {site.domain}. No refresh needed, and nothing here is
                waiting on us.
              </AlertDescription>
            </Alert>
          </>
        )}

        {status === "live" && (
          <>
            <p className="text-sm text-muted-foreground">
              ReCopyFast detected {site.domain}
              {liveSince ? ` ${liveSince}` : ""}. Editing is on — your team can
              open the edit board on any page of the site.
            </p>
            {lastReport && (
              <p className="text-sm text-muted-foreground">
                Last report {lastReport}.
              </p>
            )}
            {installation && <SnippetDisclosure installation={installation} />}
          </>
        )}

        {status === "stale" && (
          <>
            <Alert variant="warning">
              <AlertTitle>No recent activity</AlertTitle>
              <AlertDescription>
                We have had no report from {site.domain}
                {lastReport ? ` since ${lastReport}` : ""}. Your site keeps
                working and stays editable — this is a heads-up, not a fault,
                and nothing here has been switched off.
              </AlertDescription>
            </Alert>
            {installation && <SnippetDisclosure installation={installation} />}
          </>
        )}
        {!installation && (
          <Alert variant="info">
            <AlertTitle>
              {site.siteToken
                ? "Installation code is unavailable"
                : "Installation code is restricted"}
            </AlertTitle>
            <AlertDescription>
              {site.siteToken
                ? "Refresh the site details before installing. The legacy one-tag value is kept for older clients, but this screen requires both generated placements."
                : "A site admin can view and rotate the installation credentials."}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
