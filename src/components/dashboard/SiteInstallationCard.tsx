"use client";

import { formatDistanceToNow } from "date-fns";
import { Info } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { IconTile } from "@/components/ui/icon-tile";
import {
  StatusBadge,
  resolveSiteStatus,
  type SiteStatus,
} from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { installRecipes } from "@/lib/sites/install-recipes";

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
 * THE SNIPPET, EXACTLY ONCE (s66c1 AC 5). It used to be repeated inside every
 * recipe tab, and hidden behind "View install snippet" once the site was live;
 * the old detail view showed it twice more besides. After "Regenerate snippet"
 * a stale copy in a less visible place is a dead snippet an owner can paste.
 * It is now one `CodeBlock` above the recipes, in every state: the Install
 * page is itself the disclosure. The recipes say where to paste it, as text.
 *
 * A member without install credentials (`GET /api/sites` mints them for admins
 * only) sees the status and a note. The `YOUR_SITE_TOKEN` placeholder snippet
 * they used to be shown could never work.
 *
 * Purely presentational. The status arrives already resolved from
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
}

interface SiteInstallationCardProps {
  site: SiteInstallationCardSite;
}

function relativeTime(value?: string | null): string | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return formatDistanceToNow(parsed, { addSuffix: true });
}

/** Where the snippet goes, per stack (AC 5 of s02): text only. */
function WhereToPaste() {
  return (
    <div className="space-y-3">
      <p className="text-eyebrow">Where to paste it</p>
      <Tabs defaultValue={installRecipes[0].id}>
        <TabsList aria-label="Platform">
          {installRecipes.map((recipe) => (
            <TabsTrigger key={recipe.id} value={recipe.id}>
              {recipe.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {installRecipes.map((recipe) => (
          <TabsContent key={recipe.id} value={recipe.id} className="space-y-3">
            <p className="text-sm text-muted-foreground">{recipe.location}</p>
            {recipe.notes && (
              <p className="text-sm text-muted-foreground">{recipe.notes}</p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export function SiteInstallationCard({ site }: SiteInstallationCardProps) {
  const status = site.status ?? "awaiting-install";
  const definition = resolveSiteStatus(status);
  const Glyph = definition.icon;
  const embedScript = site.embedScript;

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
          </>
        )}

        {embedScript ? (
          <>
            <CodeBlock
              value={embedScript}
              label="HTML"
              copyLabel="Copy snippet"
            />
            <WhereToPaste />
          </>
        ) : (
          <Alert variant="info">
            <Info className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              Only this site&apos;s admins can see its install snippet.
            </AlertDescription>
          </Alert>
        )}

        {status === "awaiting-install" && (
          <Alert variant="info">
            <AlertTitle>Checking automatically</AlertTitle>
            <AlertDescription>
              This card updates itself within 10 seconds of the first page view
              on {site.domain}. No refresh needed, and nothing here is waiting
              on us.
            </AlertDescription>
          </Alert>
        )}

        <Button asChild variant="link" size="sm" className="h-auto px-0">
          <Link href="/docs/install">Installation guide</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
