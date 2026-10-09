"use client";

import { useCallback, useState } from "react";
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
 * Each action resolves `null` on success or the message to show — the
 * server's own words when it gave any (402 "plan ended" included), so the
 * dialog can say why without inventing a reason.
 */

export type ChangeAction =
  | "revertToDraft"
  | "revertAndPublish"
  | "discardDraft"
  | "publish";

const DRAFT_FAILED = "Could not save the draft. Try again.";
const PUBLISH_FAILED = "Could not publish. Try again.";
const NO_ORIGINAL = "This text has no original to go back to.";
const NO_LIVE_TEXT = "This text has no live version to go back to.";

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
      write: () => Promise<string | null>,
    ) => {
      setPendingAction({ rowId: row.id, action });
      try {
        return await write();
      } finally {
        setPendingAction(null);
      }
    },
    [],
  );

  const revertToDraft = useCallback(
    (row: ContentChange) =>
      track(row, "revertToDraft", async () =>
        row.original === null ? NO_ORIGINAL : saveDraft(row, row.original),
      ),
    [track],
  );

  const revertAndPublish = useCallback(
    (row: ContentChange) =>
      track(row, "revertAndPublish", async () => {
        if (row.original === null) return NO_ORIGINAL;
        // Never publish a draft that was not saved: a refused PUT (402, 403,
        // 429) leaves the old draft, or none, and publishing then would push
        // something other than the original live.
        const refused = await saveDraft(row, row.original);
        return refused ?? publishElement(row);
      }),
    [track],
  );

  const discardDraft = useCallback(
    (row: ContentChange) =>
      track(row, "discardDraft", async () =>
        row.live === null ? NO_LIVE_TEXT : saveDraft(row, row.live),
      ),
    [track],
  );

  const publish = useCallback(
    (row: ContentChange) => track(row, "publish", () => publishElement(row)),
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
