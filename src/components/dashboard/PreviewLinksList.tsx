"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePreviewLinks } from "@/hooks/usePreviewLinks";
import { ShareLinkCard, type ShareLink } from "./ShareLinkCard";

/**
 * A site's preview links, on People & access (s66c1 AC 6): `ShareLinkCard`
 * rows with revoke over `usePreviewLinks`.
 *
 * They used to be listed only inside the Share dialog, under its form, so
 * seeing who could review a site meant starting to create another link.
 *
 * No copy here (PR #72 review, D2). `GET /api/staging/access` never sends a
 * link's secret token, and must not: a list response is not where secrets
 * go. The copy action this list inherited from the dialog filled the gap with
 * the row id (`rcf_token=<id>`), so every link it copied was dead; the
 * dialog's list on main had the same fallback. A link is copied when it is
 * created, from the creation response (`ShareSiteDialog`), and this list
 * says so. There is no owner-side "resend": the only resend endpoint
 * (`POST /api/staging/verify`) is the reviewer's, keyed by the token itself.
 */

const COPY_HINT =
  "Copy a link when you create it: this list cannot show it again. Lost one? Revoke it and share a new one.";

interface PreviewLinksListProps {
  siteId: string;
  /** Changes when a link was just created elsewhere: fetch the list again. */
  reloadKey?: number;
}

export function PreviewLinksList({
  siteId,
  reloadKey = 0,
}: PreviewLinksListProps) {
  const { data, loading, error, refetch, revoke } = usePreviewLinks(siteId);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const firstReload = useRef(reloadKey);

  useEffect(() => {
    // The hook loads on mount; this is only for a change after it.
    if (reloadKey === firstReload.current) return;
    firstReload.current = reloadKey;
    void refetch();
  }, [reloadKey, refetch]);

  const handleRevoke = async (link: ShareLink) => {
    setRevokeError(null);
    const message = await revoke(link);
    if (message) setRevokeError(message);
  };

  const title = data ? `Preview links · ${data.length}` : "Preview links";

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Review links you have shared. Each one expires on its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {revokeError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>{revokeError}</AlertDescription>
          </Alert>
        )}

        {loading && !data && !error && (
          <div
            className="space-y-2"
            role="status"
            aria-label="Loading preview links"
          >
            {Array.from({ length: 2 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        )}

        {error?.isForbidden && (
          <div className="flex items-start gap-3 rounded-container border border-border bg-surface-1 p-4">
            <Lock
              className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              You cannot manage preview links on this site.
            </p>
          </div>
        )}

        {error && !error.isForbidden && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="space-y-3">
              <p>{error.message}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {data && data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No preview links. Share one when you want a review before you
            publish.
          </p>
        )}

        {data && data.length > 0 && (
          <>
            <ul className="space-y-2">
              {data.map((link) => (
                <li key={link.id}>
                  <ShareLinkCard link={link} onRevoke={handleRevoke} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{COPY_HINT}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
