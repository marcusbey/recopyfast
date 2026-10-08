"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, ExternalLink, History } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { PageShellProps } from "@/components/ui/page-shell";
import { StatusBadge, resolveSiteStatus } from "@/components/ui/status-badge";
import EditWebsiteButton from "@/components/dashboard/EditWebsiteButton";
import { VersionHistoryPanel } from "@/components/dashboard/VersionHistoryPanel";
import { OWNER_EDIT_PERMISSIONS } from "@/hooks/useEditSession";
import { useSiteContext } from "./SiteProvider";
import { SiteSubnav } from "./SiteSubnav";

function externalSiteUrl(domain: string): string {
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

/**
 * The header every site subpage shares (s66c1 AC 1): `shell`, its
 * `PageShell` props, and `editWebsiteAlert`, its one message.
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
 *
 * `editWebsiteAlert` is the header's "Edit website" refusal. Each page
 * renders it as its first child, so it reads as the first section under the
 * header and its Site navigation, at the content's left edge (a direct child
 * of `[data-page-shell]`, ADR 053). It used to render inside `actions`,
 * beside the button: at 1280 it pushed the site's name down and knocked
 * "Version history" out of line, at 375 it sat between the two buttons
 * (s66c1 pre-PR fix). It is not smuggled into `nav`: that slot is the
 * sub-navigation, and PageShell takes no seventh slot without an amendment
 * to ADR 053. `null` while there is nothing to say.
 */
export interface SitePageShell {
  shell: Omit<PageShellProps, "children">;
  editWebsiteAlert: ReactNode;
}

export function useSitePageShell(): SitePageShell {
  const { site, credentials } = useSiteContext();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const shell: Omit<PageShellProps, "children"> = {
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
          onErrorChange={setEditError}
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

  const editWebsiteAlert = editError ? (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription>{editError}</AlertDescription>
    </Alert>
  ) : null;

  return { shell, editWebsiteAlert };
}
