"use client";

import { format } from "date-fns";
import {
  AlertCircle,
  Loader2,
  PencilLine,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ContentValue } from "@/components/ui/content-value";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChangeAction } from "@/hooks/useChangeActions";
import {
  useChangeHistory,
  type ChangeHistoryEvent,
} from "@/hooks/useChangeHistory";
import type { ContentChange } from "@/hooks/useContentChanges";

interface ChangeDetailProps {
  id: string;
  row: ContentChange;
  location: string;
  canEdit: boolean;
  canPublish: boolean;
  busyAction: ChangeAction | null;
  /** A refused Publish or Edit on page, shown under the actions. */
  actionError: string | null;
  onPublish: () => void;
  onConfirm: (kind: "revert" | "discard", opener: HTMLElement) => void;
  onEditOnPage: () => void;
}

const fullDate = (iso: string) => format(new Date(iso), "d MMM yyyy, HH:mm");
const metadataTypeOf = (row: ContentChange) =>
  row.elementType === "img" ? "image" : undefined;

/**
 * What a history row says, in the owner's words. A draft whose text is the
 * original is a revert saved as a draft (nothing writes `'revert'` today; the
 * Changes page reverts through an ordinary draft save).
 */
function eventLabel(event: ChangeHistoryEvent, row: ContentChange): string {
  if (event.action === "publish") return "Published";
  if (event.action === "revert") return "Reverted to original";
  if (event.action === "create" || event.action === "update") {
    return row.original !== null && event.content === row.original
      ? "Reverted to original (draft)"
      : "Draft saved";
  }
  return "Changed";
}

function Compare({ row }: { row: ContentChange }) {
  const columns: Array<[string, string | null]> = [
    ["Original", row.original],
    ["Live now", row.live],
  ];
  if (row.state === "pending") columns.push(["Draft", row.draft]);
  const isSameAsOriginal =
    row.state === "published" && row.live === row.original;

  return (
    <div className="space-y-2">
      <div
        className={
          columns.length === 3
            ? "grid gap-3 md:grid-cols-3"
            : "grid gap-3 md:grid-cols-2"
        }
      >
        {columns.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-eyebrow text-muted-foreground">{label}</p>
            <ContentValue
              value={value ?? undefined}
              metadataType={metadataTypeOf(row)}
              label={label}
              expanded
              className="mt-1 [overflow-wrap:anywhere]"
            />
          </div>
        ))}
      </div>
      {isSameAsOriginal && (
        <p className="text-xs text-muted-foreground">
          Text is the same as the original.
        </p>
      )}
    </div>
  );
}

function History({ row }: { row: ContentChange }) {
  const { data, loading, error, refetch } = useChangeHistory(
    row.id,
    row.changedAt,
  );

  if (loading) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading history">
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="flex flex-wrap items-center gap-2">
          <span>History could not be loaded. {error}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  const discovered = (
    <li className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Discovered</span> ·{" "}
      <time dateTime={data.discoveredAt}>{fullDate(data.discoveredAt)}</time>
    </li>
  );

  return (
    <ul className="space-y-2">
      {!data.historyVisible && (
        <li className="text-xs text-muted-foreground">
          Only this site&apos;s admins can see who changed what.
        </li>
      )}
      {data.events.map((event) => (
        <li key={event.id} className="min-w-0 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">
              {eventLabel(event, row)}
            </span>
            {event.by && <> · {event.by}</>} ·{" "}
            <time dateTime={event.at}>{fullDate(event.at)}</time>
          </p>
          {event.content && (
            <p className="mt-0.5 line-clamp-2 [overflow-wrap:anywhere]">
              {event.content}
            </p>
          )}
        </li>
      ))}
      {discovered}
    </ul>
  );
}

/**
 * The expanded row (design, "Expanded row"): compare, the actions the row's
 * state and the caller's grant allow, the history, and — collapsed, for
 * support — the element id and selector, which a row never shows.
 */
export function ChangeDetail({
  id,
  row,
  location,
  canEdit,
  canPublish,
  busyAction,
  actionError,
  onPublish,
  onConfirm,
  onEditOnPage,
}: ChangeDetailProps) {
  const isBusy = busyAction !== null;
  const isPending = row.state === "pending";
  const isPublished = row.state === "published";
  const showLanguage = row.language !== "en" || row.variant !== "default";

  return (
    <div
      id={id}
      role="region"
      aria-label={`Compare and history: ${location}`}
      className="space-y-4 border-t border-border bg-surface-1 px-4 py-3"
    >
      <Compare row={row} />

      {canEdit && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {isPending && canPublish && (
              <Button size="sm" onClick={onPublish} disabled={isBusy}>
                {busyAction === "publish" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Upload aria-hidden="true" />
                )}
                Publish
              </Button>
            )}
            {isPending && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(event) => onConfirm("discard", event.currentTarget)}
                disabled={isBusy}
              >
                <X aria-hidden="true" />
                Discard draft
              </Button>
            )}
            {isPublished && (
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => onConfirm("revert", event.currentTarget)}
                disabled={isBusy}
              >
                <RotateCcw aria-hidden="true" />
                Revert to original
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onEditOnPage}>
              <PencilLine aria-hidden="true" />
              Edit on page
            </Button>
            {isPending && !canPublish && (
              <span className="text-xs text-muted-foreground">
                Publishing needs publish rights on this site.
              </span>
            )}
          </div>
          {actionError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-eyebrow text-muted-foreground">History</p>
        <History row={row} />
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Technical details
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Element id</dt>
          <dd className="min-w-0 rounded-control bg-surface-2 px-1.5 py-0.5 font-mono [overflow-wrap:anywhere]">
            {row.elementId}
          </dd>
          <dt className="text-muted-foreground">Selector</dt>
          <dd className="min-w-0 rounded-control bg-surface-2 px-1.5 py-0.5 font-mono [overflow-wrap:anywhere]">
            {row.selector ?? "—"}
          </dd>
          {showLanguage && (
            <>
              <dt className="text-muted-foreground">Language</dt>
              <dd className="font-mono">
                {row.language} · {row.variant}
              </dd>
            </>
          )}
        </dl>
      </details>
    </div>
  );
}
