import type { ChangeAction } from "@/hooks/useChangeActions";
import type { ContentChange } from "@/hooks/useContentChanges";

/**
 * What the row becomes after a write that succeeded, without a reload (design,
 * "success in place"). The server derives the state (ADR 054); this mirrors
 * its rules for the one row that changed. A discarded draft cannot know
 * `published_at`, so a row published back to its original reads Original here
 * until the next read says Published.
 *
 * `draftAttributes` follows the RPCs exactly, because Discard sends it back
 * as is (useChangeActions.ts, `discardAttributes`). Tombstone (Devin
 * re-review N1, critical): this never touched it. After Publish made a staged
 * link live, the row kept that link's OLD live value; Revert → Save as draft,
 * then Discard, sent the old value back, and the save RPC (20260924030000,
 * `save_staging_content_atomic`) STAGED it, since it now differed from the
 * live link, so the next Publish silently put the old link back on the
 * customer's page. Per action:
 * - Publish, and Revert and publish: the publish RPC (20260924060000) writes
 *   the live metadata plus the staged changes, minus `staging_attributes`:
 *   nothing is staged any more;
 * - Discard: only offered when every staged attribute goes back with its live
 *   value, and the save RPC drops a staged key equal to the live one;
 * - Revert → Save as draft (and a revert whose publish failed): a text-only
 *   PUT merges an empty patch, so a pending row's staged attributes, and the
 *   live values beside them, stand unchanged (an unread list stays unread);
 *   a row that was not pending stages nothing that differs from live (the
 *   view's pending test), and the save RPC drops a key equal to live.
 * Exact from the row alone, so no row is re-read after a write.
 */
export function rowAfter(
  row: ContentChange,
  action: ChangeAction,
): Partial<ContentChange> {
  const changedAt = new Date().toISOString();
  switch (action) {
    case "revertToDraft":
      return {
        draft: row.original,
        draftAttributes: row.state === "pending" ? row.draftAttributes : [],
        state: row.original !== row.live ? "pending" : row.state,
        changedAt,
      };
    case "revertAndPublish":
      return {
        state: "published",
        live: row.original,
        draft: null,
        draftAttributes: [],
        changedAt,
      };
    case "discardDraft":
      return {
        state: row.live !== row.original ? "published" : "original",
        draft: null,
        draftAttributes: [],
        changedAt,
      };
    case "publish":
      return {
        state: "published",
        live: row.draft ?? row.live,
        draft: null,
        draftAttributes: [],
        changedAt,
      };
  }
}
