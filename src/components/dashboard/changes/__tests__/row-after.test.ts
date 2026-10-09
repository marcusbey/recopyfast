import { discardAttributes } from "@/hooks/useChangeActions";
import type { ContentChange } from "@/hooks/useContentChanges";
import { rowAfter } from "../row-after";

/**
 * s70b, Devin re-review N1 (critical) — the row a write leaves on screen
 * must say what the draft stages NOW, because Discard sends exactly that back
 * (useChangeActions.ts, `discardAttributes`).
 *
 * `rowAfter` never touched `draftAttributes`. After Publish made a staged link
 * live, the row still held the link's OLD live value; Revert → Save as draft,
 * then Discard, sent it back, and the save RPC (20260924030000,
 * `save_staging_content_atomic`) STAGED it, because it now differed from the
 * live link. The next Publish silently put the old link back.
 *
 * Each case follows the RPCs (20260924030000, 20260924060000):
 * - Publish, and Revert and publish once its POST lands: the publish RPC
 *   rewrites `metadata` as the live metadata plus the staged changes, without
 *   `staging_attributes` — nothing is staged any more;
 * - Discard: offered only when every staged attribute could be sent back with
 *   its live value, and the save RPC drops a staged key equal to the live one;
 * - Revert → Save as draft (a revert whose publish failed included): a
 *   text-only PUT MERGES an empty patch, so a pending row's staged attributes
 *   and their live values stand unchanged; a row that was not pending stages
 *   nothing that differs from live (the view's own pending test), and the
 *   save RPC drops a key equal to live.
 */

function row(overrides: Partial<ContentChange> = {}): ContentChange {
  return {
    id: "row-1",
    siteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    elementId: "rcf-v6di4rh42g",
    pagePath: "/",
    elementType: "a",
    selector: "#root > main > a",
    language: "en",
    variant: "default",
    original: "Start free trial",
    live: "Start free trial",
    draft: "Start your 14-day trial",
    draftAttributes: [{ name: "href", live: "/signup" }],
    state: "pending",
    changedAt: "2026-10-08T10:00:00+00:00",
    changedBy: null,
    createdAt: "2026-09-28T09:00:00+00:00",
    ...overrides,
  };
}

const after = (before: ContentChange, action: Parameters<typeof rowAfter>[1]) =>
  ({ ...before, ...rowAfter(before, action) }) as ContentChange;

describe("rowAfter — what the draft stages after each write", () => {
  it("stages nothing after Publish: the staged link is live now", () => {
    const published = after(row(), "publish");

    expect(published.state).toBe("published");
    expect(published.draftAttributes).toEqual([]);
  });

  it("stages nothing after Discard draft", () => {
    expect(after(row(), "discardDraft").draftAttributes).toEqual([]);
  });

  it("stages nothing after Revert and publish", () => {
    const published = row({
      state: "published",
      live: "Start your 14-day trial",
      draft: null,
    });

    expect(after(published, "revertAndPublish").draftAttributes).toEqual([]);
  });

  it("stages nothing after Revert → Save as draft on a row that was not pending, whatever the row held", () => {
    // The N1 row: published from this page while still holding the old live
    // value of a link that went live.
    const published = row({
      state: "published",
      live: "Start your 14-day trial",
      draft: null,
    });

    const reverted = after(published, "revertToDraft");

    expect(reverted.state).toBe("pending");
    expect(reverted.draftAttributes).toEqual([]);
    expect(discardAttributes(reverted)).toEqual({});
  });

  it("keeps a pending row's staged link after Revert → Save as draft, so Discard still sends it back to live", () => {
    const pending = row({ live: "Start now", draft: "Start your trial" });

    const reverted = after(pending, "revertToDraft");

    expect(reverted.state).toBe("pending");
    expect(reverted.draftAttributes).toEqual([
      { name: "href", live: "/signup" },
    ]);
    expect(discardAttributes(reverted)).toEqual({ href: "/signup" });
  });

  it("keeps a pending row's unread list unread after Revert → Save as draft: still no Discard", () => {
    const pending = row({
      live: "Start now",
      draft: "Start your trial",
      draftAttributes: null,
    });

    const reverted = after(pending, "revertToDraft");

    expect(reverted.draftAttributes).toBeNull();
    expect(discardAttributes(reverted)).toBeNull();
  });

  it("walks the N1 sequence to a discard that sends no link", () => {
    const published = after(row(), "publish");
    const reverted = after(published, "revertToDraft");

    expect(discardAttributes(reverted)).toEqual({});
  });
});
