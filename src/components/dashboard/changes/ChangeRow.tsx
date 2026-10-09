"use client";

import { useId, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  History as HistoryIcon,
  ImageIcon,
  MoreVertical,
  PencilLine,
  RotateCcw,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { classifyContent } from "@/components/ui/content-value";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge, contentStatuses } from "@/components/ui/status-badge";
import type { ChangeAction } from "@/hooks/useChangeActions";
import type { ChangesSite, ContentChange } from "@/hooks/useContentChanges";
import {
  editPermissionsForGrant,
  useEditSession,
  type SiteGrant,
} from "@/hooks/useEditSession";
import { describeElement } from "@/lib/content/describe-location";
import { cn } from "@/lib/utils/cn";
import { ChangeDetail } from "./ChangeDetail";
import { RevertDialog, type ConfirmKind } from "./RevertDialog";

/** "Edit on page" opens a session as long as the site's own Edit website. */
const EDIT_SESSION_HOURS = 2;

/**
 * One line at ≥ 768 (design, "Row anatomy"): expand · status · location ·
 * text · who/when · Open · ⋮. Below it the row stacks: status and location,
 * then the text on two lines, then who/when beside Open. The narrow layout's
 * last track is `auto`, not the ⋮'s 2rem: Open is wider than ⋮, and in a
 * 2rem track it overflowed leftwards over the who/when line. Every child is
 * `min-w-0`, so a long string truncates inside its track instead of pushing
 * the panel sideways (the dialog rule, one level down).
 */
const ROW_GRID = [
  "grid items-center gap-x-3 gap-y-1 px-4 py-3 md:min-h-11 md:py-1.5",
  "grid-cols-[2rem_auto_minmax(0,1fr)_auto]",
  "[grid-template-areas:'expand_status_location_menu'_'._text_text_text'_'._who_who_open']",
  "md:grid-cols-[2rem_6rem_minmax(10rem,1.1fr)_minmax(0,2fr)_11rem_auto_2rem]",
  "md:[grid-template-areas:'expand_status_location_text_who_open_menu']",
].join(" ");

const isSiteGrant = (value: string): value is SiteGrant =>
  ["view", "edit", "publish", "admin"].includes(value);

/** The text that matters for the row's state (design, Row anatomy). */
function shownText(row: ContentChange): string | null {
  if (row.state === "pending") return row.draft;
  if (row.state === "published") return row.live;
  return row.original;
}

function fileName(value: string): string {
  if (/^data:/i.test(value)) return "Embedded image";
  try {
    const name = new URL(value).pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : value;
  } catch {
    return value;
  }
}

interface ChangeRowProps {
  row: ContentChange;
  site: ChangesSite;
  pageLabel: string;
  /** The action in flight on this row, if any. */
  busyAction: ChangeAction | null;
  onAction: (
    row: ContentChange,
    action: ChangeAction,
  ) => Promise<string | null>;
}

export function ChangeRow({
  row,
  site,
  pageLabel,
  busyAction,
  onAction,
}: ChangeRowProps) {
  const detailId = `${useId()}-detail`;
  const [isExpanded, setIsExpanded] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const { openEditSession } = useEditSession(site.domain);

  const grant = isSiteGrant(site.permission) ? site.permission : undefined;
  const editPermissions = editPermissionsForGrant(grant);
  const canEdit = editPermissions.length > 0;
  const canPublish = grant === "publish" || grant === "admin";
  // History is admin-only by RLS, so `changedBy` is null for anyone else;
  // the grant check keeps the rule here too, whatever a response carries.
  const isAdmin = grant === "admin";

  const location = describeElement({
    selector: row.selector,
    elementType: row.elementType,
    elementId: row.elementId,
    pageLabel,
  });
  const path = row.pagePath ?? "/";
  const pageUrl = `https://${site.domain}${path}`;
  const status = contentStatuses[row.state];
  const text = shownText(row) ?? "";
  const isImage =
    classifyContent(text, row.elementType === "img" ? "image" : undefined) ===
    "image";
  const who = isAdmin && row.changedBy ? row.changedBy : null;

  const openConfirm = (kind: ConfirmKind, opener: HTMLElement | null) => {
    openerRef.current = opener;
    setConfirmError(null);
    setConfirm(kind);
  };

  const runConfirmed = async (action: ChangeAction) => {
    setConfirmError(null);
    const refused = await onAction(row, action);
    if (refused) {
      setConfirmError(refused);
      return;
    }
    setConfirm(null);
  };

  const publish = async () => {
    setActionError(null);
    const refused = await onAction(row, "publish");
    if (refused) setActionError(refused);
  };

  // Inside the click itself: the tab must open on the user's activation.
  const editOnPage = async () => {
    setActionError(null);
    const refused = await openEditSession(
      {
        siteId: site.id,
        permissions: editPermissions,
        durationHours: EDIT_SESSION_HOURS,
      },
      path,
    );
    if (refused) setActionError(refused);
  };

  // Focus goes back to what opened the dialog; when that control is gone
  // (Discard turns a pending row original, so its button leaves), the row
  // keeps focus on its expand button (design, Accessibility).
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const opener = openerRef.current;
    (opener?.isConnected ? opener : expandRef.current)?.focus();
  };

  return (
    <li className="border-b border-border last:border-b-0">
      <div className={ROW_GRID}>
        <Button
          ref={expandRef}
          variant="ghost"
          size="icon-sm"
          aria-expanded={isExpanded}
          aria-controls={detailId}
          aria-label={`Compare and history: ${location}`}
          className="[grid-area:expand]"
          onClick={() => setIsExpanded((open) => !open)}
        >
          {isExpanded ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </Button>

        <div className="min-w-0 [grid-area:status]">
          <StatusBadge status={status} />
        </div>

        <p
          className="min-w-0 truncate text-sm font-medium text-foreground [grid-area:location]"
          title={location}
        >
          {location}
        </p>

        <p
          data-row-text
          className="line-clamp-2 min-w-0 text-sm text-foreground [grid-area:text] [overflow-wrap:anywhere] md:line-clamp-none md:truncate"
          title={text}
        >
          {isImage ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
              <ImageIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="truncate">{fileName(text)}</span>
            </span>
          ) : (
            text
          )}
        </p>

        <p className="min-w-0 truncate text-xs text-muted-foreground [grid-area:who]">
          {who && `${who} · `}
          {row.changedAt && (
            <time
              dateTime={row.changedAt}
              title={format(new Date(row.changedAt), "d MMM yyyy, HH:mm")}
            >
              {formatDistanceToNow(new Date(row.changedAt), {
                addSuffix: true,
              })}
            </time>
          )}
        </p>

        {/* Styled with `buttonVariants`, not `<Button asChild>`: Button wraps
            its children in a Fragment, so Slot clones the Fragment and every
            class (the grid area included) is dropped. */}
        <a
          href={pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${location} on ${site.domain}${path} in a new tab`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "justify-self-end [grid-area:open]",
          )}
        >
          Open
          <ExternalLink aria-hidden="true" />
        </a>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={menuRef}
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${location}`}
              className="justify-self-end [grid-area:menu]"
            >
              <MoreVertical aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <a
                href={pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open on page
              </a>
            </DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => void editOnPage()}
              >
                <PencilLine className="h-4 w-4" aria-hidden="true" />
                Edit on page
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => setIsExpanded(true)}
            >
              <HistoryIcon className="h-4 w-4" aria-hidden="true" />
              Compare and history
            </DropdownMenuItem>
            {canEdit && row.state !== "original" && <DropdownMenuSeparator />}
            {canEdit && row.state === "published" && (
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => openConfirm("revert", menuRef.current)}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Revert to original
              </DropdownMenuItem>
            )}
            {canEdit && row.state === "pending" && (
              <DropdownMenuItem
                className="gap-2 text-tone-danger-text focus:text-tone-danger-text"
                onSelect={() => openConfirm("discard", menuRef.current)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Discard draft
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isExpanded && (
        <ChangeDetail
          id={detailId}
          row={row}
          location={location}
          canEdit={canEdit}
          canPublish={canPublish}
          busyAction={busyAction}
          actionError={actionError}
          onPublish={() => void publish()}
          onConfirm={openConfirm}
          onEditOnPage={() => void editOnPage()}
        />
      )}

      <RevertDialog
        kind={confirm}
        row={row}
        where={`${location} on ${pageLabel}, ${site.domain}`}
        canPublish={canPublish}
        busyAction={confirm ? busyAction : null}
        error={confirmError}
        onConfirm={(action) => void runConfirmed(action)}
        onClose={() => setConfirm(null)}
        onCloseAutoFocus={restoreFocus}
      />
    </li>
  );
}
