"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { BulkOperations } from "@/components/dashboard/BulkOperations";
import { DeleteSiteDialog } from "@/components/dashboard/DeleteSiteDialog";
import { DomainVerification } from "@/components/dashboard/DomainVerification";
import { WebhooksPanel } from "@/components/dashboard/WebhooksPanel";
import { useSiteContext } from "@/components/dashboard/site/SiteProvider";
import { useSitePageShell } from "@/components/dashboard/site/useSitePageShell";

/**
 * Settings (advanced): everything a site does not need to start editing
 * (s66c1 AC 8). In the old detail view these panels sat 1,690 to 3,500 px
 * down one page, under the install snippet.
 */
export default function SiteSettingsPage() {
  const shell = useSitePageShell();
  const { site } = useSiteContext();
  const router = useRouter();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const generalId = useId();
  const dangerId = useId();

  return (
    <PageShell {...shell}>
      <p className="text-sm text-muted-foreground">
        Advanced settings. You don&apos;t need any of these to start editing.
      </p>

      {/* Read-only: `src/app/api/sites/[siteId]/route.ts` exports only
          DELETE. Changing `sites.domain` changes which origin
          `authorizeSiteRequest` accepts on a live install, so it is its own
          API story, not a field to make editable here. */}
      <section aria-labelledby={generalId}>
        <Card className="border-border">
          <CardHeader>
            <CardTitle id={generalId}>General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-1 rounded-container border border-border bg-surface-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="px-4 pt-3 text-muted-foreground sm:py-3">Name</dt>
              <dd className="min-w-0 px-4 pb-3 text-foreground [overflow-wrap:anywhere] sm:py-3">
                {site.name}
              </dd>
              <dt className="border-t border-border px-4 pt-3 text-muted-foreground sm:py-3">
                Domain
              </dt>
              <dd className="min-w-0 px-4 pb-3 font-mono text-foreground [overflow-wrap:anywhere] sm:border-t sm:border-border sm:py-3">
                {site.domain}
              </dd>
            </dl>
            <p className="text-sm text-muted-foreground">
              Renaming a site or changing its domain isn&apos;t available yet.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Domain ownership. Optional, and it blocks nothing: the embed script
          is admitted by its signed site token and its origin, never by a
          `domain_verifications` row. It moved here from the install
          surface, where it read as a step. */}
      <Card className="border-border">
        <CardContent className="p-6">
          <DomainVerification siteId={site.id} siteDomain={site.domain} />
        </CardContent>
      </Card>

      <WebhooksPanel siteId={site.id} />

      <BulkOperations siteId={site.id} />

      <section aria-labelledby={dangerId}>
        <Card className="border-tone-danger-border">
          <CardHeader>
            <CardTitle id={dangerId}>Danger zone</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="min-w-0 max-w-prose">
                <p className="text-sm font-semibold text-foreground">
                  Delete site
                </p>
                <p className="text-sm text-muted-foreground">
                  Permanently delete {site.name}, its content, editors and
                  preview links. This can&apos;t be undone.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setIsDeleteOpen(true)}
              >
                Delete site
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* `replace`, not `push`: Back must not return to a deleted site's
          page, which would only say "Site not found". */}
      <DeleteSiteDialog
        site={isDeleteOpen ? site : null}
        onOpenChange={setIsDeleteOpen}
        onDeleted={() => router.replace("/dashboard/sites")}
      />
    </PageShell>
  );
}
