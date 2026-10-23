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

export type DriftAction = Extract<
  ChangeAction,
  "keepOverride" | "takeNewSource"
>;

interface SourceDriftDialogProps {
  action: DriftAction | null;
  row: ContentChange;
  /** "Main heading on Homepage, acme.example". */
  where: string;
  /** The action in flight, to disable the buttons and spin the pressed one. */
  busyAction: ChangeAction | null;
  error: string | null;
  onConfirm: (action: DriftAction) => void;
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

const COPY: Record<
  DriftAction,
  { title: string; confirm: string; failed: string; note: string }
> = {
  keepOverride: {
    title: "Keep the override?",
    confirm: "Keep override",
    failed: "Not kept.",
    note: "Visitors keep seeing the edited text. The next deploy that changes this element is flagged again.",
  },
  takeNewSource: {
    title: "Use the new source?",
    confirm: "Use new source",
    failed: "Not changed.",
    note: "The edit is dropped and visitors see the page's own text. The history keeps the edited version.",
  },
};

/**
 * s119 (ADR 075): resolving a source drift is never one click, like Revert
 * (RevertDialog): the dialog shows what visitors see before and after. Both
 * actions go through `useChangeActions`; this only asks and reports. A refusal
 * that changed nothing stays in the dialog with the server's words; a stale one
 * (a newer deploy observed) closes on the re-read row (ChangeRow).
 */
export function SourceDriftDialog({
  action,
  row,
  where,
  busyAction,
  error,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: SourceDriftDialogProps) {
  const isBusy = busyAction !== null;
  const drift = row.sourceDrift ?? null;
  const copy = action ? COPY[action] : null;

  return (
    <Dialog
      open={action !== null && drift !== null}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{where}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                <p className="font-medium">{copy?.failed}</p>
                <p>{error}</p>
              </AlertDescription>
            </Alert>
          )}
          {action === "keepOverride" ? (
            <>
              <Block label="Visitors keep seeing" value={row.live} row={row} />
              <Block
                label="Page now says"
                value={drift?.observed ?? null}
                row={row}
              />
            </>
          ) : (
            <>
              <Block
                label="Visitors will see"
                value={drift?.observed ?? null}
                row={row}
              />
              <Block label="Instead of" value={row.live} row={row} />
            </>
          )}
          <p className="text-xs text-muted-foreground">{copy?.note}</p>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
          {action && copy && (
            <Button
              variant={action === "takeNewSource" ? "destructive" : "default"}
              onClick={() => onConfirm(action)}
              disabled={isBusy}
            >
              {busyAction === action && (
                <Loader2 className="animate-spin" aria-hidden="true" />
              )}
              {copy.confirm}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
