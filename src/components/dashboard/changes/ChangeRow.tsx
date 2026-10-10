"use client";

import { useEffect, useId, useRef, useState } from "react";
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
import {
  canDiscardDraft,
  type ActionOutcome,
  type ChangeAction,
} from "@/hooks/useChangeActions";
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
 * text · who/when · Open · ⋮. Below it the row stacks as the design draws it:
 * status, the location and ⋮ on the first line; the text on two lines; then
 * who/when and Open on the last line, Open under ⋮.
 *
 * Five tracks, `2rem auto minmax(0,1fr) auto 2rem`. ⋮ alone owns the last
 * (2rem, its own width) on the first line; the location spans the flexible
 * track and the `auto` one beside it, so it runs up to ⋮. On the last line
 * Open spans that `auto` track and ⋮'s, and who/when spans the status track
 * and the flexible one. Items that cross the flexible track (location, text,
 * who/when) are left out of the `auto` tracks' sizing, so the status track is
 * the badge's width and the fourth track is only what Open needs beyond
 * ⋮'s 2rem. Every child is `min-w-0`, so a long string truncates inside its
 * area instead of pushing the panel sideways (the dialog rule, one level down).
 *
 * Tombstones. s70b review m4: ⋮ and Open shared one last track, ⋮ on the
 * first line, Open on the third. A track is as wide as its widest item, so
 * Open's width was taken from the location's line and cut it to a few
 * characters at 375. The first fix moved ⋮ down beside Open, and that cut
 * "when" ("sam@example.com · 2…", s70b re-review N2). Open spanning ⋮'s track
 * on another line takes nothing from either line.
 */
const ROW_GRID = [
  "grid items-center gap-x-3 gap-y-1 px-4 py-3 md:min-h-11 md:py-1.5",
  "grid-cols-[2rem_auto_minmax(0,1fr)_auto_2rem]",
  "[grid-template-areas:'expand_status_location_location_menu'_'._text_text_text_text'_'._who_who_open_open']",
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

/**
 * The row's page on its own site, or null when the stored path is not one
 * same-site absolute path: then the row offers no Open at all.
 *
 * Tombstone (s70b review m3): this was `https://${domain}${path}`, and
 * `page_path` is recorded by the embed on the customer's page. A path of
 * ".evil.example/" made the link https://acme.example.evil.example/. Built
 * with `new URL(path, origin)` instead, "//evil.example/x" leaves the site
 * outright, so the leading-slash rule comes first; and the URL parser drops
 * tabs and newlines and reads `\` as `/`, so "/\t/evil.example" is
 * "//evil.example" once parsed: the host is compared after parsing too.
 */
function pageUrlFor(domain: string, pagePath: string | null): string | null {
  const path = pagePath ?? "/";
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith("/\\")
  ) {
    return null;
  }
  try {
    const origin = new URL(`https://${domain}`);
    const url = new URL(path, origin);
    return url.host === origin.host ? url.toString() : null;
  } catch {
    return null;
  }
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
  /** The action in flight on this row, if any (its spinner). */
  busyAction: ChangeAction | null;
  /**
   * A write to this row's element is in flight, from this row or another
   * language or variant of it: every write action is disabled until it has
   * ended and been read again (useChangeActions.ts, `isElementWriting`).
   */
  isLocked: boolean;
  onAction: (
    row: ContentChange,
    action: ChangeAction,
  ) => Promise<ActionOutcome>;
}

export function ChangeRow({
  row,
  site,
  pageLabel,
  busyAction,
  isLocked,
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
  const pageUrl = pageUrlFor(site.domain, row.pagePath);
  const status = contentStatuses[row.state];
  const text = shownText(row) ?? "";
  const isImage =
    classifyContent(text, row.elementType === "img" ? "image" : undefined) ===
    "image";
  const who = isAdmin && row.changedBy ? row.changedBy : null;
  // A draft on text never published, or whose staged link or alt cannot be
  // sent back through the PUT, is not offered a discard that would leave it
  // pending (useChangeActions.ts, `canDiscardDraft`). A published row whose
  // text is the original has nothing to revert (the publish RPC would skip
  // that draft).
  const canDiscard = canEdit && row.state === "pending" && canDiscardDraft(row);
  const canRevert =
    canEdit && row.state === "published" && row.live !== row.original;

  const openConfirm = (kind: ConfirmKind, opener: HTMLElement | null) => {
    openerRef.current = opener;
    setConfirmError(null);
    setConfirm(kind);
  };

  // Nothing landed: the dialog stays open with the reason. Something landed
  // but not all of it (a revert saved, its publish refused), nothing was
  // sent because the row changed elsewhere (Discard's re-read), or no answer
  // came back and it may have landed: the dialog closes on the row as the
  // server now holds it, opened, with the reason under its actions — where
  // they can be reviewed and tried again.
  const runConfirmed = async (action: ChangeAction) => {
    setConfirmError(null);
    const outcome = await onAction(row, action);
    const isRowToReview = outcome.isStale || outcome.isUncertain;
    if (outcome.error && !outcome.applied && !isRowToReview) {
      setConfirmError(outcome.error);
      return;
    }
    setConfirm(null);
    if (outcome.error) {
      setActionError(outcome.error);
      setIsExpanded(true);
    }
  };

  // A published row has no Publish button: once it is gone, focus stays in
  // the row, on its expand button (design, Accessibility), instead of
  // falling to the page. The button leaves with the re-read row, which may
  // be drawn before or after this action settles: if focus has not fallen
  // yet, the row's next commit looks again.
  const isRestoringFocus = useRef(false);
  const hasFocusFallen = () => {
    const focused = document.activeElement;
    return !focused || focused === document.body;
  };
  useEffect(() => {
    if (!isRestoringFocus.current) return;
    isRestoringFocus.current = false;
    if (hasFocusFallen()) expandRef.current?.focus();
  }, [row]);

  const publish = async () => {
    setActionError(null);
    const outcome = await onAction(row, "publish");
    if (outcome.error) setActionError(outcome.error);
    if (!outcome.applied) return;
    if (hasFocusFallen()) expandRef.current?.focus();
    else isRestoringFocus.current = true;
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

        {/* At 375 this line is ~174 px: a long address truncates on its own,
            and "when" never shrinks (s70b re-review N2). */}
        <p className="flex min-w-0 text-xs text-muted-foreground [grid-area:who]">
          {who && (
            <>
              <span className="min-w-0 truncate">{who}</span>
              <span className="shrink-0 whitespace-pre"> · </span>
            </>
          )}
          {row.changedAt && (
            <time
              className="shrink-0 whitespace-nowrap"
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
        {pageUrl && (
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
        )}

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
            {pageUrl && (
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
            )}
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
            {(canRevert || canDiscard) && <DropdownMenuSeparator />}
            {canRevert && (
              <DropdownMenuItem
                className="gap-2"
                disabled={isLocked}
                onSelect={() => openConfirm("revert", menuRef.current)}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Revert to original
              </DropdownMenuItem>
            )}
            {canDiscard && (
              <DropdownMenuItem
                className="gap-2 text-tone-danger-text focus:text-tone-danger-text"
                disabled={isLocked}
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
          canDiscard={canDiscard}
          canRevert={canRevert}
          busyAction={busyAction}
          isLocked={isLocked}
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
