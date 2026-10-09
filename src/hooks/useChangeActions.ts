"use client";

import { useCallback, useRef, useState } from "react";
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
  /**
   * No answer came back from a write (the connection dropped): it may have
   * landed or not. The row is read again so the owner sees what it holds.
   */
  isUncertain?: boolean;
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
export const NEVER_PUBLISHED_NOTE =
  "This text was never published, so its draft can't be discarded here. Edit or publish it on the page.";
export const UPDATED_ELSEWHERE =
  "This change was updated elsewhere — review it again.";
const NOT_CHECKED =
  "Could not check this draft before discarding it. Try again.";
const NOT_REREAD =
  "This went through, but the row could not be read again and may be out of date. Reload the page to see it as it is now.";
/** Appended to a message that already says something did not go to plan. */
const ROW_OUT_OF_DATE =
  "The row could not be read again and may be out of date. Reload the page to see it as it is now.";
const lost = (what: string) =>
  `The connection dropped before the server answered, so ${what}. Check the row before trying again.`;
const PUBLISH_LOST = lost("it may or may not have been published");
const REVERT_LOST = lost("the revert may or may not have been saved");
const DISCARD_LOST = lost("the draft may or may not have been discarded");
const REVERT_SAVED = "The revert was saved as a draft.";
/** The page disables these rows; this is the hook's own guard behind it. */
const ELEMENT_BUSY =
  "A change to this text is still being saved. Try again once it has finished.";
/**
 * How long a write request may go unanswered before the page gives up on it
 * (the repo's fetch-timeout form: `DELIVERY_TIMEOUT_MS`, webhooks/manager.ts).
 * A draft save or a one-element publish answers in well under a second.
 */
const WRITE_TIMEOUT_MS = 30_000;

/**
 * Why a write did not land. `isUncertain`: no answer came back at all (the
 * request may have reached the server and committed); otherwise the server
 * answered and refused, and nothing changed.
 */
interface WriteFailure {
  error: string;
  isUncertain: boolean;
}

const refusal = (error: string): ActionOutcome => ({ error, applied: null });
const outcomeOf = (
  action: ChangeAction,
  failure: WriteFailure | null,
): ActionOutcome => {
  if (!failure) return { error: null, applied: action };
  return failure.isUncertain
    ? { error: failure.error, applied: null, isUncertain: true }
    : refusal(failure.error);
};

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

/**
 * Whether a pending draft can be discarded from this page: it has published
 * text of its own to go back to, and every attribute it stages can go back.
 *
 * Tombstone (verification of 63d7ba2, minor 6): a translation is written with
 * no published text (api/ai/translate), and "Live now" stands in the original
 * for it. Discard saved that original as the draft, which the view still
 * compares with the NULL published text: the row stayed Pending under
 * "Draft discarded." Clearing a draft to NULL needs a discard operation no
 * existing route has (the staging PUT stores `String(content)`), so such a
 * draft is not offered a discard, and the row says why.
 */
export const canDiscardDraft = (row: ContentChange): boolean =>
  row.hasLiveText && discardAttributes(row) !== null;

/** Why a pending draft is not offered a discard (`canDiscardDraft` false). */
export const discardRefusal = (row: ContentChange): string => {
  if (!row.hasLiveText) return NEVER_PUBLISHED_NOTE;
  return Array.isArray(row.draftAttributes)
    ? ATTRIBUTE_DRAFT_NOTE
    : UNREAD_DRAFT_NOTE;
};

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
 * One write request. A response, ok or not, is the server's word. No
 * response at all is not a refusal: the request may have reached the server
 * and committed before the connection dropped. Tombstone (verification of
 * 63d7ba2, minor 5): that case read "Could not save the draft. Try again."
 * and the row was not read again, so a draft the server had discarded or
 * published was still drawn Pending, with a dialog saying "Not discarded."
 *
 * A request still unanswered after `WRITE_TIMEOUT_MS` is aborted, and the
 * abort throws, so it ends the same way: read again, said to be uncertain.
 * Tombstone (verification of d381b7b, minor 3): there was no timeout, and a
 * request that never settled held its element's lock, every language and
 * variant row of it disabled, until the page was reloaded.
 */
async function send(
  url: string,
  method: "PUT" | "POST",
  body: unknown,
  { refused, lostMessage }: { refused: string; lostMessage: string },
): Promise<WriteFailure | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
  } catch {
    return { error: lostMessage, isUncertain: true };
  }
  if (response.ok) return null;
  return { error: await refusalMessage(response, refused), isUncertain: false };
}

/**
 * The draft body is exactly the four fields the staging PUT reads. The text is
 * sent as stored: ordinary copy (`&`, quotes, dashes, emoji) round-trips byte
 * for byte through `sanitizeIncomingContent`.
 */
const saveDraft = (
  row: ContentChange,
  content: string,
  lostMessage: string,
  attributes: ContentAttributePatch = {},
): Promise<WriteFailure | null> =>
  send(
    `/api/staging/content/${row.siteId}`,
    "PUT",
    {
      elementId: row.elementId,
      content,
      language: row.language,
      variant: row.variant,
      ...attributes,
    },
    { refused: DRAFT_FAILED, lostMessage },
  );

/**
 * Publishes this element only. The RPC publishes every language and variant
 * draft of the `element_id` (research, traps), which is the editor's own
 * behaviour for the same button.
 */
const publishElement = (row: ContentChange): Promise<WriteFailure | null> =>
  send(
    "/api/staging/publish",
    "POST",
    { siteId: row.siteId, elementIds: [row.elementId] },
    { refused: PUBLISH_FAILED, lostMessage: PUBLISH_LOST },
  );

/** One write from this page, from its first request to its re-read. */
export interface WriteInFlight {
  /** Unique per write: a write that ends clears its own entry, no other. */
  id: number;
  rowId: string;
  siteId: string;
  elementId: string;
  action: ChangeAction;
}

type ElementOf = Pick<ContentChange, "siteId" | "elementId">;

/**
 * Whether a write to the row's element is in flight, from any of its rows:
 * every language and variant row of an element is locked while one of them
 * is written. An element id is unique only within a site, hence both.
 */
export const isElementWriting = (
  writes: readonly WriteInFlight[],
  row: ElementOf,
): boolean =>
  writes.some(
    (write) => write.siteId === row.siteId && write.elementId === row.elementId,
  );

/** The action in flight on this very row, for its spinner; null if none. */
export const busyActionOf = (
  writes: readonly WriteInFlight[],
  row: Pick<ContentChange, "id">,
): ChangeAction | null =>
  writes.find((write) => write.rowId === row.id)?.action ?? null;

export function useChangeActions({ reread }: ChangeActionsOptions = {}) {
  // One entry per write, never one slot for the page. Tombstone
  // (verification of 63d7ba2, major): `pendingAction` held "the" write in
  // flight and the row compared its own id with it. Discard on an fr row
  // stayed enabled while Publish on the en row of the same element was in
  // flight: its re-read landed before the publish committed and its PUT
  // after, so the old text was staged again under "Draft discarded.". And a
  // second write replaced the first one's entry, and whichever ended first
  // cleared both, so a row in flight was offered its buttons again.
  //
  // CTO decision: the lock is the element (site + element id), not the row
  // and not the page. Publish promotes every language and variant row of
  // the element and nothing else (20260924060000); a draft save writes one
  // row of it; Discard's pre-read and every re-read read the element. Two
  // writes to two elements cannot touch each other's rows, so they run side
  // by side. The ref is the guard (it changes synchronously, before any
  // render); the state is what the rows draw.
  const [inFlight, setInFlight] = useState<readonly WriteInFlight[]>([]);
  const writing = useRef<readonly WriteInFlight[]>([]);
  const writeCount = useRef(0);

  const track = useCallback(
    async (
      row: ContentChange,
      action: ChangeAction,
      write: () => Promise<ActionOutcome>,
    ): Promise<ActionOutcome> => {
      if (isElementWriting(writing.current, row)) return refusal(ELEMENT_BUSY);
      writeCount.current += 1;
      const entry: WriteInFlight = {
        id: writeCount.current,
        rowId: row.id,
        siteId: row.siteId,
        elementId: row.elementId,
        action,
      };
      writing.current = [...writing.current, entry];
      setInFlight(writing.current);
      try {
        const outcome = await write();
        // Read the element again whenever the server may hold something
        // other than what the row shows: a write landed, the row changed
        // elsewhere, or no answer came back.
        const isWorthRereading =
          outcome.applied !== null ||
          outcome.isStale === true ||
          outcome.isUncertain === true;
        if (!reread || !isWorthRereading) return outcome;
        if (await reread(row)) return outcome;
        // Whatever the message said, the row under it was not read again.
        // Tombstone (verification of 63d7ba2, minor 5): this was said only
        // after a write that landed, so a stale Discard said "review it
        // again" over a row that had not been refreshed.
        return {
          ...outcome,
          error: outcome.error
            ? `${outcome.error} ${ROW_OUT_OF_DATE}`
            : NOT_REREAD,
        };
      } finally {
        writing.current = writing.current.filter(({ id }) => id !== entry.id);
        setInFlight(writing.current);
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
        return outcomeOf(
          "revertToDraft",
          await saveDraft(row, original, REVERT_LOST),
        );
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
        // something other than the original live. Nor one whose save went
        // unanswered: it may not exist.
        const draftFailed = await saveDraft(row, original, REVERT_LOST);
        if (draftFailed) return outcomeOf("revertAndPublish", draftFailed);
        const publishFailed = await publishElement(row);
        if (!publishFailed) return outcomeOf("revertAndPublish", null);
        // Two writes, not one: the draft is saved and pending now. Tombstone
        // (Devin review, PR #77): this returned the POST's refusal alone, the
        // dialog said "Not reverted", and the row stayed Published while its
        // revert waited as a draft that any later Publish would push.
        const lead = publishFailed.isUncertain
          ? REVERT_SAVED
          : REVERT_NOT_PUBLISHED;
        return {
          error: `${lead} ${publishFailed.error}`,
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
  // owner was shown, nothing is sent. Residual: a write from elsewhere (a
  // second tab, the editor on the live page) landing between this read and
  // the save RPC is not seen. That window is not milliseconds: it is this
  // read's way back, then everything the staging PUT does before its RPC
  // (`authorizeFirstPartyEditorAccess`, `enforceRateLimit`,
  // `checkOwnerCanEdit`, each a round trip), so hundreds of milliseconds or
  // more. This page's writes cannot land there while it stays mounted (one
  // write at a time per element, above), but the lock lives in the mounted
  // page, not the tab. Correction (verification of d381b7b, minor 2): this
  // said "This page's own writes cannot land there". Leaving the page while
  // a write is still out and coming back mounts a new, unlocked page, and
  // that write, still running, can land in this window too. Closing it needs
  // a compare-and-set in the staging PUT, an existing route this story does
  // not change (follow-up: s81-version-restore-integrity).
  const discardDraft = useCallback(
    (row: ContentChange) =>
      track(row, "discardDraft", async () => {
        if (row.live === null) return refusal(NO_LIVE_TEXT);
        if (!canDiscardDraft(row)) return refusal(discardRefusal(row));
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
        if (!attributes || !canDiscardDraft(fresh)) {
          return { error: discardRefusal(fresh), applied: null, isStale: true };
        }
        if (fresh.live === null) return refusal(NO_LIVE_TEXT);
        return outcomeOf(
          "discardDraft",
          await saveDraft(fresh, fresh.live, DISCARD_LOST, attributes),
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
    /** Every write in flight; see `isElementWriting` and `busyActionOf`. */
    inFlight,
  };
}
