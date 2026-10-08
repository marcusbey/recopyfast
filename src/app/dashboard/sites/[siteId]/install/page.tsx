"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageShell } from "@/components/ui/page-shell";
import { SiteInstallationCard } from "@/components/dashboard/SiteInstallationCard";
import { useSiteContext } from "@/components/dashboard/site/SiteProvider";
import { useSitePageShell } from "@/components/dashboard/site/useSitePageShell";

/**
 * Install: the snippet once, where to paste it, and the site token
 * (s66c1 AC 5).
 *
 * Every credential on this page is the provider's `credentials`, never the
 * site record's: after "Regenerate snippet" the record is stale until the
 * next fetch, and the old token is already revoked (ADR 052).
 */
export default function SiteInstallPage() {
  const shell = useSitePageShell();
  const {
    site,
    credentials,
    regenerateSnippet,
    regeneration,
    clearRegenerationError,
  } = useSiteContext();
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);

  const closeRegenerate = () => {
    setIsRegenerateOpen(false);
    clearRegenerationError();
  };

  const handleRegenerate = async () => {
    if (await regenerateSnippet()) setIsRegenerateOpen(false);
  };

  return (
    <PageShell {...shell}>
      {regeneration.hasSucceeded && (
        <Alert variant="success">
          <AlertTitle>Snippet regenerated</AlertTitle>
          <AlertDescription>
            Copy this new snippet to your site. Old snippets no longer work for
            new requests. Existing live editing connections may continue until
            they reconnect.
          </AlertDescription>
        </Alert>
      )}

      {/* Installation.
          This replaces the "Integration Status" card that stood here. Its
          "Script Installation" and "API Connection" rows were two differently
          worded readings of one `content_elements` count — which was itself a
          third reading of what the header pill already said. The card below is
          the single source, driven by the persisted state machine on `sites`
          rather than by a count. */}
      <SiteInstallationCard
        site={{
          ...site,
          embedScript: credentials.embedScript,
          siteToken: credentials.siteToken,
        }}
      />

      {credentials.siteToken && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Site token</CardTitle>
            <CardDescription>
              This token identifies your site to ReCopyFast. It is visible in
              your page&apos;s HTML by design. ReCopyFast checks it against the
              requesting page&apos;s origin and accepts browser requests only
              when it matches your registered domain. Regenerate snippet revokes
              old snippets; replace the snippet on your site afterward.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CodeBlock
              value={credentials.siteToken}
              label="Token"
              copyLabel="Copy site token"
            />
            <Button
              variant="outline"
              onClick={() => {
                clearRegenerationError();
                setIsRegenerateOpen(true);
              }}
            >
              <RotateCcw aria-hidden="true" />
              Regenerate snippet
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Moved from the detail view with its copy. Bound to the credentials
          as well as to its own state: a refresh that loses admin closes it. */}
      <Dialog
        open={isRegenerateOpen && Boolean(credentials.siteToken)}
        onOpenChange={(open) => {
          if (regeneration.isPending) return;
          if (open) setIsRegenerateOpen(true);
          else closeRegenerate();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Regenerate snippet?</DialogTitle>
            <DialogDescription>
              Old snippets stop working for new requests as soon as this
              succeeds. Existing live editing connections may continue until
              they reconnect. Replace the snippet on {site.domain} with the new
              one shown here.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {regeneration.error && (
              <Alert variant="destructive">
                <AlertTitle>Snippet was not regenerated</AlertTitle>
                <AlertDescription>{regeneration.error}</AlertDescription>
              </Alert>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={regeneration.isPending}
              onClick={closeRegenerate}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={regeneration.isPending}
              onClick={() => void handleRegenerate()}
            >
              {regeneration.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Regenerating…
                </>
              ) : (
                "Regenerate now"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
