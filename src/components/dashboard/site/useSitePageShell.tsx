"use client";

import { useState } from "react";
import { ExternalLink, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PageShellProps } from "@/components/ui/page-shell";
import { StatusBadge, resolveSiteStatus } from "@/components/ui/status-badge";
import EditWebsiteButton from "@/components/dashboard/EditWebsiteButton";
import { VersionHistoryPanel } from "@/components/dashboard/VersionHistoryPanel";
import { useSiteContext } from "./SiteProvider";
import { SiteSubnav } from "./SiteSubnav";

/**
 * What an owner's "Edit website" has always sent from a site's own controls
 * (the Sites row, its menu, this header): their permissions without `view`.
 */
export const OWNER_EDIT_PERMISSIONS: ["edit", "admin"] = ["edit", "admin"];

function externalSiteUrl(domain: string): string {
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

/**
 * The header every site subpage shares (s66c1 AC 1), as `PageShell` props.
 *
 * A hook rather than a wrapper component so that each page renders
 * `<PageShell {...shell}>` itself: the page-shell guard reads each routed
 * page for `<PageShell`, and a wrapper would hide it (ADR 053).
 *
 * - `title`: the site's name, the page's only h1;
 * - `meta`: its status;
 * - `description`: the domain, out to the live site;
 * - `actions`: "Edit website", and "Version history", which opens the
 *   hand-rolled side sheet (design-system gap 12, still open). The sheet is
 *   `position: fixed` and renders nothing while closed, so it sits with the
 *   button that opens it;
 * - `nav`: the four subpages.
 */
export function useSitePageShell(): Omit<PageShellProps, "children"> {
  const { site, credentials } = useSiteContext();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  return {
    title: site.name,
    meta: <StatusBadge status={resolveSiteStatus(site.status)} />,
    description: (
      <a
        href={externalSiteUrl(site.domain)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-0 items-center gap-1 rounded-control font-mono text-xs text-muted-foreground underline-offset-4 [overflow-wrap:anywhere] hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {site.domain}
        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    ),
    actions: (
      <>
        <EditWebsiteButton
          site={site}
          userPermissions={OWNER_EDIT_PERMISSIONS}
        />
        <Button variant="outline" onClick={() => setIsHistoryOpen(true)}>
          <History aria-hidden="true" />
          Version history
        </Button>
        <VersionHistoryPanel
          open={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          siteId={site.id}
          stagingToken={credentials.siteToken ?? ""}
        />
      </>
    ),
    nav: <SiteSubnav siteId={site.id} />,
  };
}
