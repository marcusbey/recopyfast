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
 * rows with copy and revoke over `usePreviewLinks`.
 *
 * They used to be listed only inside the Share dialog, under its form, so
 * seeing who could review a site meant starting to create another link.
 */

interface PreviewLinksListProps {
  siteId: string;
  domain: string;
  /** Changes when a link was just created elsewhere: fetch the list again. */
  reloadKey?: number;
}

/** The URL a reviewer opens. Moved from the Share dialog unchanged. */
function previewUrl(domain: string, link: ShareLink): string {
  const siteUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  return `${siteUrl}?rcf_staging=1&rcf_token=${link.token || link.id}`;
}

export function PreviewLinksList({
  siteId,
  domain,
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

  const handleCopy = async (link: ShareLink) => {
    try {
      await navigator.clipboard.writeText(previewUrl(domain, link));
    } catch (caught) {
      console.error("Failed to copy a preview link:", caught);
    }
  };

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
          <ul className="space-y-2">
            {data.map((link) => (
              <li key={link.id}>
                <ShareLinkCard
                  link={link}
                  onCopy={(target) => void handleCopy(target)}
                  onRevoke={handleRevoke}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
