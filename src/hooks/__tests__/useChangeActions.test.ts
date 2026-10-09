import { act, renderHook } from "@testing-library/react";
import {
  useChangeActions,
  type ActionOutcome,
  type ChangeAction,
} from "../useChangeActions";
import type { ContentChange } from "../useContentChanges";

/**
 * s70b — a row's actions write only through the two existing routes (ADR 042
 * paths: plan gate, per-site limiter, atomic RPC, audit row). No new write
 * route exists for this page, so these requests are the whole write surface,
 * and each is pinned byte for byte:
 * - Revert → Save as draft: PUT /api/staging/content/<site> with the original;
 * - Revert and publish: that PUT, then POST /api/staging/publish for this one
 *   element — and never the POST when the PUT was refused;
 * - Discard draft: the PUT with the live text, and every attribute the draft
 *   stages sent back with its live value; Publish: the POST alone.
 * A refusal comes back as the server's own words (402 "plan ended"
 * included), and nothing else is called. Each action also says what landed
 * (`applied`), so a revert whose publish failed is shown as the draft it is.
 *
 * Devin review (PR #77): a discard that sent the text alone left a staged
 * link change in place (the save RPC merges attribute patches), and Publish
 * still pushed it; a revert-and-publish whose POST failed left its saved draft
 * invisible; a revert of text already equal to the original "succeeded" with
 * nothing to publish.
 */

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDINARY_COPY = `Fish & chips — "the best" in town 🐟 'since 1998'`;
const PLAN_ENDED =
  "This site's plan has ended. Ask the site owner to renew, then try again.";

function row(overrides: Partial<ContentChange> = {}): ContentChange {
  return {
    id: "row-1",
    siteId: SITE_ID,
    elementId: "rcf-1gom2eazz3g",
    pagePath: "/",
    elementType: "h1",
    selector: "#root > main > h1",
    language: "fr",
    variant: "b",
    original: ORDINARY_COPY,
    live: "Ship copy changes in minutes, not sprints",
    draft: null,
    draftAttributes: [],
    state: "published",
    changedAt: "2026-10-08T10:00:00+00:00",
    changedBy: null,
    createdAt: "2026-09-28T09:00:00+00:00",
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchCalls = () =>
  (global.fetch as jest.Mock).mock.calls.map(([url, init]) => ({
    url,
    method: (init as RequestInit).method,
    contentType: new Headers((init as RequestInit).headers).get("Content-Type"),
    body: (init as RequestInit).body,
  }));

const PUT_REVERT = {
  url: `/api/staging/content/${SITE_ID}`,
  method: "PUT",
  contentType: "application/json",
  body: JSON.stringify({
    elementId: "rcf-1gom2eazz3g",
    content: ORDINARY_COPY,
    language: "fr",
    variant: "b",
  }),
};

const POST_PUBLISH = {
  url: "/api/staging/publish",
  method: "POST",
  contentType: "application/json",
  body: JSON.stringify({ siteId: SITE_ID, elementIds: ["rcf-1gom2eazz3g"] }),
};

const done = (applied: ChangeAction): ActionOutcome => ({
  error: null,
  applied,
});
const refused = (error: string | RegExp) => ({
  error: typeof error === "string" ? error : expect.stringMatching(error),
  applied: null,
});

async function run(
  action: ChangeAction,
  target: ContentChange,
): Promise<ActionOutcome | null> {
  const { result } = renderHook(() => useChangeActions());
  let outcome: ActionOutcome | null = null;
  await act(async () => {
    outcome = await result.current[action](target);
  });
  return outcome;
}

describe("useChangeActions", () => {
  beforeEach(() => {
    global.fetch = jest
      .fn()
      .mockImplementation(async () =>
        response({ success: true }),
      ) as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it("saves the original as a draft with one PUT, byte for byte", async () => {
    const outcome = await run("revertToDraft", row());

    expect(outcome).toEqual(done("revertToDraft"));
    expect(fetchCalls()).toEqual([PUT_REVERT]);
    expect(JSON.parse(fetchCalls()[0].body as string).content).toBe(
      ORDINARY_COPY,
    );
  });

  it("reverts and publishes: the PUT, then a POST for this one element", async () => {
    const outcome = await run("revertAndPublish", row());

    expect(outcome).toEqual(done("revertAndPublish"));
    expect(fetchCalls()).toEqual([PUT_REVERT, POST_PUBLISH]);
  });

  it("never publishes when the draft was refused, and returns the 402's own words", async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      response({ error: PLAN_ENDED, reason: "plan_ended" }, 402),
    );

    const outcome = await run("revertAndPublish", row());

    expect(outcome).toEqual(refused(PLAN_ENDED));
    expect(fetchCalls()).toEqual([PUT_REVERT]);
  });

  it("says the revert landed as a draft when the draft saved but the publish did not", async () => {
    (global.fetch as jest.Mock)
      .mockImplementationOnce(async () => response({ success: true }))
      .mockImplementationOnce(async () =>
        response({ error: "Publish rate limit exceeded for this site." }, 429),
      );

    const outcome = await run("revertAndPublish", row());

    expect(outcome).toEqual({
      error:
        "The revert was saved as a draft but not published. Publish rate limit exceeded for this site.",
      applied: "revertToDraft",
    });
    expect(fetchCalls()).toEqual([PUT_REVERT, POST_PUBLISH]);
  });

  it.each(["revertToDraft", "revertAndPublish"] as const)(
    "%s sends nothing when the live text is already the original",
    async (action) => {
      const outcome = await run(action, row({ live: ORDINARY_COPY }));

      expect(outcome).toEqual(refused(/already the original/i));
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it("discards a draft with a PUT of the live text", async () => {
    const pending = row({
      state: "pending",
      live: ORDINARY_COPY,
      draft: "Start your 14-day trial",
    });

    const outcome = await run("discardDraft", pending);

    expect(outcome).toEqual(done("discardDraft"));
    expect(fetchCalls()).toEqual([PUT_REVERT]);
  });

  it("discards a staged link and alt too: each goes back to its live value in the same PUT", async () => {
    const pending = row({
      state: "pending",
      live: ORDINARY_COPY,
      draft: "Start your 14-day trial",
      draftAttributes: [
        { name: "href", live: "/pricing?plan=team&ref=hero" },
        { name: "alt", live: "" },
      ],
    });

    const outcome = await run("discardDraft", pending);

    expect(outcome).toEqual(done("discardDraft"));
    expect(fetchCalls()).toEqual([
      {
        ...PUT_REVERT,
        body: JSON.stringify({
          elementId: "rcf-1gom2eazz3g",
          content: ORDINARY_COPY,
          language: "fr",
          variant: "b",
          href: "/pricing?plan=team&ref=hero",
          alt: "",
        }),
      },
    ]);
  });

  it.each([
    ["has no live value to go back to", { name: "href", live: null }],
    [
      "is not a value the staging PUT accepts back as is",
      { name: "href", live: " /pricing " },
    ],
    ["is not one the staging PUT knows", { name: "title", live: "Pricing" }],
  ])(
    "refuses to discard, sending nothing, when a staged attribute %s",
    async (_label, attribute) => {
      const pending = row({
        state: "pending",
        live: ORDINARY_COPY,
        draft: "Start your 14-day trial",
        draftAttributes: [attribute],
      });

      expect(await run("discardDraft", pending)).toEqual(
        refused(/link or image/i),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it("publishes with the POST alone", async () => {
    const outcome = await run(
      "publish",
      row({ state: "pending", draft: "Start now" }),
    );

    expect(outcome).toEqual(done("publish"));
    expect(fetchCalls()).toEqual([POST_PUBLISH]);
  });

  it("returns the server's words verbatim for a 402 on a single write", async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      response({ error: PLAN_ENDED, reason: "plan_ended" }, 402),
    );

    expect(await run("revertToDraft", row())).toEqual(refused(PLAN_ENDED));
    expect(fetchCalls()).toEqual([PUT_REVERT]);
  });

  it("says the write failed when the refusal carries no words", async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      response({}, 500),
    );

    expect(await run("publish", row())).toEqual(refused(/could not publish/i));
  });

  it("sends nothing when the row has no text to go back to", async () => {
    expect(await run("revertToDraft", row({ original: null }))).toEqual(
      refused(/no original/i),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports which row is in flight while a write runs", async () => {
    let finish!: (value: Response) => void;
    (global.fetch as jest.Mock).mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(() => useChangeActions());

    let pending!: Promise<ActionOutcome>;
    act(() => {
      pending = result.current.publish(row());
    });
    expect(result.current.pendingAction).toEqual({
      rowId: "row-1",
      action: "publish",
    });

    await act(async () => {
      finish(response({ success: true }));
      await pending;
    });
    expect(result.current.pendingAction).toBeNull();
  });
});
