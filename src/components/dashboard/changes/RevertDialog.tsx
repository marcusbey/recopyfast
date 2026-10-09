"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ContentValue } from "@/components/ui/content-value";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChangeAction } from "@/hooks/useChangeActions";
import type { ContentChange } from "@/hooks/useContentChanges";

export type ConfirmKind = "revert" | "discard";

interface RevertDialogProps {
  kind: ConfirmKind | null;
  row: ContentChange;
  /** "Main heading on Homepage, acme.example". */
  where: string;
  canPublish: boolean;
  /** The action in flight, to disable the buttons and spin the pressed one. */
  busyAction: ChangeAction | null;
  error: string | null;
  onConfirm: (action: ChangeAction) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

const metadataTypeOf = (row: ContentChange) =>
  row.elementType === "img" ? "image" : undefined;

function Block({
  label,
  value,
  row,
}: {
  label: string;
  value: string | null;
  row: ContentChange;
}) {
  return (
    <div className="min-w-0 rounded-container bg-surface-1 px-3 py-2.5">
      <p className="text-eyebrow text-muted-foreground">{label}</p>
      <ContentValue
        value={value ?? undefined}
        metadataType={metadataTypeOf(row)}
        label={label}
        expanded
        className="mt-1 [overflow-wrap:anywhere]"
      />
    </div>
  );
}

/**
 * Revert and discard are never one click (design, "Revert"): the dialog shows
 * what is live and what it goes back to. Both writes go through the existing
 * routes (`useChangeActions`); this only asks and reports. A refusal stays in
 * the dialog with the server's own words (402 "plan ended" included), and the
 * dialog closes only on success.
 */
export function RevertDialog({
  kind,
  row,
  where,
  canPublish,
  busyAction,
  error,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: RevertDialogProps) {
  const isBusy = busyAction !== null;
  const spinner = (action: ChangeAction) =>
    busyAction === action ? (
      <Loader2 className="animate-spin" aria-hidden="true" />
    ) : null;

  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {kind === "discard"
              ? "Discard this draft?"
              : "Revert to the original text?"}
          </DialogTitle>
          <DialogDescription>{where}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                <p className="font-medium">
                  {kind === "discard" ? "Not discarded." : "Not reverted."}
                </p>
                <p>{error}</p>
              </AlertDescription>
            </Alert>
          )}
          {kind === "discard" ? (
            <>
              <Block label="Draft" value={row.draft} row={row} />
              <Block label="Live now" value={row.live} row={row} />
            </>
          ) : (
            <>
              <Block label="Live now" value={row.live} row={row} />
              <Block label="Original" value={row.original} row={row} />
              {!canPublish && (
                <p className="text-xs text-muted-foreground">
                  It goes live when someone with publish rights publishes it.
                </p>
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
          {kind === "discard" ? (
            <Button
              variant="destructive"
              onClick={() => onConfirm("discardDraft")}
              disabled={isBusy}
            >
              {spinner("discardDraft")}
              Discard draft
            </Button>
          ) : (
            <>
              <Button
                variant={canPublish ? "outline" : "default"}
                onClick={() => onConfirm("revertToDraft")}
                disabled={isBusy}
              >
                {spinner("revertToDraft")}
                Save as draft
              </Button>
              {canPublish && (
                <Button
                  onClick={() => onConfirm("revertAndPublish")}
                  disabled={isBusy}
                >
                  {spinner("revertAndPublish")}
                  Revert and publish
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
