"use client";

import { useCallback, useState } from "react";
import {
  validateContentAttributePatch,
  type ContentAttributePatch,
} from "@/lib/api/validation";
import {
  readElementChanges,
  type ContentChange,
  type DraftAttribute,
} from "./useContentChanges";

/**
 * A row's writes from the Changes page (s70b), through the two routes the
 * editor already uses — never a route of this page's own.
 *
 * `PUT /api/staging/content/<site>` saves a draft and its `staging_history`
 * row in one RPC; `POST /api/staging/publish` pushes drafts live. Both
 * authorize the signed-in member, run a per-site fail-closed limiter and the
 * owner's plan gate (`checkOwnerCanEdit`, 402), and write through the service
 * client only after all three (ADR 042). A revert is therefore just a draft
 * whose text is the original: the same path, the same audit, the same gate.
 *
 * Each action resolves an `ActionOutcome`: the message to show, if any — the
 * server's own words when it gave any (402 "plan ended" included), so the
 * dialog can say why without inventing a reason — and what landed.
 *
 * What the row looks like afterwards is never derived here: once a write has
 * landed, `reread` (the list's `refreshAfterWrite`) reads the element again,
 * inside the action, so the row stays busy until the server has said what it
 * holds. Tombstone (s70b fix pass, C1): the row was redrawn from what the
 * action meant to do, and Publish promotes every language and variant row of
 * the element, so a sibling kept a draft the server no longer had.
 */

export type ChangeAction =
  | "revertToDraft"
  | "revertAndPublish"
  | "discardDraft"
  | "publish";

export interface ActionOutcome {
  /** What to tell the owner; null when everything asked for landed. */
  error: string | null;
  /**
   * What landed on the server: the action itself on success, the draft alone
   * when a revert saved but its publish failed, null when nothing changed.
   */
  applied: ChangeAction | null;
  /**
   * Nothing was written because the server's row is not the one on screen
   * (Discard's re-read): the row is read again so the owner can review it.
   */
  isStale?: boolean;
}

interface ChangeActionsOptions {
  /**
   * Reads the row's element again after a write (and after a stale Discard);
   * resolves false when it could not. The action stays in flight until then.
   */
  reread?: (row: ContentChange) => Promise<boolean>;
}

const DRAFT_FAILED = "Could not save the draft. Try again.";
const PUBLISH_FAILED = "Could not publish. Try again.";
const NO_ORIGINAL = "This text has no original to go back to.";
const NO_LIVE_TEXT = "This text has no live version to go back to.";
const ALREADY_ORIGINAL = "This text is already the original.";
const REVERT_NOT_PUBLISHED =
  "The revert was saved as a draft but not published.";
export const ATTRIBUTE_DRAFT_NOTE =
  "This draft changes a link or image attribute, which can't be discarded here. Change it on the page.";
/** Said when what the draft stages is not known: it may change no attribute. */
export const UNREAD_DRAFT_NOTE =
  "This draft could not be read in full, so it can't be discarded here. Reload the page to try again.";
export const UPDATED_ELSEWHERE =
  "This change was updated elsewhere — review it again.";
const NOT_CHECKED =
  "Could not check this draft before discarding it. Try again.";
const NOT_REREAD =
  "This went through, but the row could not be read again and may be out of date. Reload the page to see it as it is now.";

const refusal = (error: string): ActionOutcome => ({ error, applied: null });
const outcomeOf = (
  action: ChangeAction,
  error: string | null,
): ActionOutcome => ({ error, applied: error ? null : action });

/**
 * The attribute half of a discard: every attribute the draft stages, sent
 * back with its live value. Null when one of them cannot go back that way.
 *
 * Tombstone (Devin review, PR #77): Discard sent the live text alone. The
 * save RPC (20260924030000, `save_staging_content_atomic`) MERGES the
 * request's attribute patch into the staged ones, so a staged link stayed
 * staged, the row stayed pending, and the next Publish pushed the link the
 * owner had just discarded. The same RPC drops a staged key whose value equals
 * the live one, so sending each key back with its live value clears it through
 * the existing PUT (no new route, no RPC). That works only for a value the
 * PUT accepts back unchanged: a key with no live value (the RPC compares a
 * JSON string with SQL NULL), a key the PUT does not know, or a value its
 * validation would trim or refuse cannot be cleared here, and the page says
 * so instead of announcing a discard that did not happen.
 *
 * Nor can a list that is not known (null: the list route could not read it;
 * or not a list at all, which threw "not iterable" here, Devin re-review N4):
 * the draft may stage a link, and a text-only discard would leave it staged.
 */
export function discardAttributes(
  row: ContentChange,
): ContentAttributePatch | null {
  if (!Array.isArray(row.draftAttributes)) return null;
  const patch: ContentAttributePatch = {};
  for (const { name, live } of row.draftAttributes) {
    if ((name !== "href" && name !== "alt") || live === null) return null;
    const accepted = validateContentAttributePatch({ [name]: live });
    if (!accepted.ok || accepted.value[name] !== live) return null;
    patch[name] = live;
  }
  return patch;
}

/** Why a pending draft is not offered a discard (`discardAttributes` null). */
export const discardRefusal = (row: ContentChange): string =>
  Array.isArray(row.draftAttributes) ? ATTRIBUTE_DRAFT_NOTE : UNREAD_DRAFT_NOTE;

const stagedNames = (attributes: DraftAttribute[]): string =>
  attributes
    .map(({ name }) => name)
    .sort()
    .join("\u0000");

/**
 * Whether the server still holds the draft the owner was shown: still
 * pending, the same draft text, the same staged attributes. The live text
 * and live attribute values may have moved (a bulk update writes the live
 * text under a pending draft); the discard sends the current ones.
 */
function isSameDraft(seen: ContentChange, fresh: ContentChange): boolean {
  if (fresh.state !== "pending" || fresh.draft !== seen.draft) return false;
  if (!Array.isArray(fresh.draftAttributes)) return true;
  return (
    Array.isArray(seen.draftAttributes) &&
    stagedNames(seen.draftAttributes) === stagedNames(fresh.draftAttributes)
  );
}

async function refusalMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: unknown } | null)?.error;
    if (typeof message === "string" && message) return message;
  } catch {
    // Not JSON: the fallback says what failed.
  }
  return fallback;
}

/**
 * The draft body is exactly the four fields the staging PUT reads. The text is
 * sent as stored: ordinary copy (`&`, quotes, dashes, emoji) round-trips byte
 * for byte through `sanitizeIncomingContent`.
 */
async function saveDraft(
  row: ContentChange,
  content: string,
  attributes: ContentAttributePatch = {},
): Promise<string | null> {
  try {
    const response = await fetch(`/api/staging/content/${row.siteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elementId: row.elementId,
        content,
        language: row.language,
        variant: row.variant,
        ...attributes,
      }),
    });
    return response.ok ? null : await refusalMessage(response, DRAFT_FAILED);
  } catch {
    return DRAFT_FAILED;
  }
}

/**
 * Publishes this element only. The RPC publishes every language and variant
 * draft of the `element_id` (research, traps), which is the editor's own
 * behaviour for the same button.
 */
async function publishElement(row: ContentChange): Promise<string | null> {
  try {
    const response = await fetch("/api/staging/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: row.siteId, elementIds: [row.elementId] }),
    });
    return response.ok ? null : await refusalMessage(response, PUBLISH_FAILED);
  } catch {
    return PUBLISH_FAILED;
  }
}

export function useChangeActions({ reread }: ChangeActionsOptions = {}) {
  const [pendingAction, setPendingAction] = useState<{
    rowId: string;
    action: ChangeAction;
  } | null>(null);

  const track = useCallback(
    async (
      row: ContentChange,
      action: ChangeAction,
      write: () => Promise<ActionOutcome>,
    ): Promise<ActionOutcome> => {
      setPendingAction({ rowId: row.id, action });
      try {
        const outcome = await write();
        if (!reread || (!outcome.applied && !outcome.isStale)) return outcome;
        const isFresh = await reread(row);
        if (isFresh || !outcome.applied) return outcome;
        return {
          ...outcome,
          error: outcome.error ? `${outcome.error} ${NOT_REREAD}` : NOT_REREAD,
        };
      } finally {
        setPendingAction(null);
      }
    },
    [reread],
  );

  // Nothing to revert when the live text is the original. Tombstone (Devin
  // review, PR #77): a row published back to its original stays Published
  // (`published_at`), and saving that same text "succeeded" with nothing
  // pending: the publish RPC skips a draft equal to the live text.
  const revertToDraft = useCallback(
    (row: ContentChange) =>
      track(row, "revertToDraft", async () => {
        const original = row.original;
        if (original === null) return refusal(NO_ORIGINAL);
        if (original === row.live) return refusal(ALREADY_ORIGINAL);
        return outcomeOf("revertToDraft", await saveDraft(row, original));
      }),
    [track],
  );

  const revertAndPublish = useCallback(
    (row: ContentChange) =>
      track(row, "revertAndPublish", async () => {
        const original = row.original;
        if (original === null) return refusal(NO_ORIGINAL);
        if (original === row.live) return refusal(ALREADY_ORIGINAL);
        // Never publish a draft that was not saved: a refused PUT (402, 403,
        // 429) leaves the old draft, or none, and publishing then would push
        // something other than the original live.
        const draftRefused = await saveDraft(row, original);
        if (draftRefused) return refusal(draftRefused);
        const publishRefused = await publishElement(row);
        if (!publishRefused) return outcomeOf("revertAndPublish", null);
        // Two writes, not one: the draft is saved and pending now. Tombstone
        // (Devin review, PR #77): this returned the POST's refusal alone, the
        // dialog said "Not reverted", and the row stayed Published while its
        // revert waited as a draft that any later Publish would push.
        return {
          error: `${REVERT_NOT_PUBLISHED} ${publishRefused}`,
          applied: "revertToDraft",
        };
      }),
    [track],
  );

  // The row is read again just before the PUT, and the PUT is built from
  // that read. Tombstone (s70b fix pass, M1): it sent the live text and links
  // as the page had loaded them, so a view gone stale (a second tab, an
  // editor publishing from the live page) staged the old copy again, and the
  // next Publish put it back live. When the draft is no longer the one the
  // owner was shown, nothing is sent. Residual: a write landing between this
  // read and the PUT (milliseconds) is not seen; closing it needs a
  // compare-and-set in the staging PUT, an existing route this story does not
  // change (follow-up: s81-version-restore-integrity).
  const discardDraft = useCallback(
    (row: ContentChange) =>
      track(row, "discardDraft", async () => {
        if (row.live === null) return refusal(NO_LIVE_TEXT);
        if (!discardAttributes(row)) return refusal(discardRefusal(row));
        let fresh: ContentChange | undefined;
        try {
          const rows = await readElementChanges(row.siteId, row.elementId);
          fresh = rows.find((candidate) => candidate.id === row.id);
        } catch {
          return refusal(NOT_CHECKED);
        }
        if (!fresh || !isSameDraft(row, fresh)) {
          return { error: UPDATED_ELSEWHERE, applied: null, isStale: true };
        }
        const attributes = discardAttributes(fresh);
        if (!attributes) {
          return { error: discardRefusal(fresh), applied: null, isStale: true };
        }
        if (fresh.live === null) return refusal(NO_LIVE_TEXT);
        return outcomeOf(
          "discardDraft",
          await saveDraft(fresh, fresh.live, attributes),
        );
      }),
    [track],
  );

  const publish = useCallback(
    (row: ContentChange) =>
      track(row, "publish", async () =>
        outcomeOf("publish", await publishElement(row)),
      ),
    [track],
  );

  return {
    revertToDraft,
    revertAndPublish,
    discardDraft,
    publish,
    pendingAction,
  };
}
