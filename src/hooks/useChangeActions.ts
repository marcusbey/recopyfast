"use client";

import { useCallback, useState } from "react";
import {
  validateContentAttributePatch,
  type ContentAttributePatch,
} from "@/lib/api/validation";
import type { ContentChange } from "./useContentChanges";

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
 * dialog can say why without inventing a reason — and what landed, so the
 * row can be drawn as it now is.
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

export function useChangeActions() {
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
        return await write();
      } finally {
        setPendingAction(null);
      }
    },
    [],
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

  const discardDraft = useCallback(
    (row: ContentChange) =>
      track(row, "discardDraft", async () => {
        if (row.live === null) return refusal(NO_LIVE_TEXT);
        const attributes = discardAttributes(row);
        if (!attributes) return refusal(discardRefusal(row));
        return outcomeOf(
          "discardDraft",
          await saveDraft(row, row.live, attributes),
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
