"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The one confirmation before `DELETE /api/sites/[siteId]` (s66c1 AC 3 and
 * AC 8), shared by the Sites row menu and a site's Danger zone.
 *
 * Only the site's creator may delete it: the route answers anyone else with
 * a 403 ("Only the site creator can delete this site"). `GET /api/sites`
 * does not say who created a site, so the action is offered to every admin
 * and that refusal is shown here, in the dialog, where the owner is looking.
 * Hiding it properly needs the list to return the caller's role: an API
 * follow-up, out of this story.
 *
 * Delete was reachable only through a hover-only menu on the old site card,
 * which a touch screen cannot open. Both entry points now work by taps.
 */

interface DeleteSiteDialogProps {
  /** The site to delete; the dialog is open while one is set. */
  site: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  /** The site is gone: drop it from the list, or leave its pages. */
  onDeleted: (siteId: string) => void;
}

export function DeleteSiteDialog({
  site,
  onOpenChange,
  onDeleted,
}: DeleteSiteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownSiteId, setShownSiteId] = useState(site?.id ?? null);

  // Opening for a site re-arms the confirmation. A successful delete leaves
  // it disabled on purpose (below), and the Sites list keeps this one dialog
  // mounted for every row, so the next site's confirmation starts fresh.
  const siteId = site?.id ?? null;
  if (siteId !== shownSiteId) {
    setShownSiteId(siteId);
    if (siteId) {
      setIsDeleting(false);
      setError(null);
    }
  }

  const close = () => {
    if (isDeleting) return;
    setError(null);
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!site) return;
    setIsDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/sites/${site.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data: unknown = await response.json();
        const errData = data as { error?: string };
        throw new Error(errData.error ?? "Failed to delete site");
      }

      // Still deleting, as far as the owner is concerned, until the caller
      // takes the dialog away. On a site's Danger zone that is
      // `router.replace` to Sites, which is in flight with the dialog still on
      // screen; re-enabling the button there let a second tap send another
      // DELETE for a site that no longer exists and flash its refusal (s66c1
      // review m6). The next opening re-arms it.
      onDeleted(site.id);
    } catch (err) {
      console.error("Error deleting site:", err);
      setError(err instanceof Error ? err.message : "Failed to delete site");
      setIsDeleting(false);
    }
  };

  return (
    <Dialog
      open={site !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete site?</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this site? This action cannot be
            undone and will remove all associated data.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Deleting…
              </>
            ) : (
              "Delete site"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
