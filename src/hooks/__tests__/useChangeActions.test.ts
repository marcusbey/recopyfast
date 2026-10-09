import { act, renderHook } from "@testing-library/react";
import { useChangeActions } from "../useChangeActions";
import type { ContentChange } from "../useContentChanges";

/**
 * s70b — a row's actions write only through the two existing routes (ADR 042
 * paths: plan gate, per-site limiter, atomic RPC, audit row). No new write
 * route exists for this page, so these requests are the whole write surface,
 * and each is pinned byte for byte:
 * - Revert → Save as draft: PUT /api/staging/content/<site> with the original;
 * - Revert and publish: that PUT, then POST /api/staging/publish for this one
 *   element — and never the POST when the PUT was refused;
 * - Discard draft: the PUT with the live text; Publish: the POST alone.
 * A refusal comes back as the server's own words (402 "plan ended"
 * included), and nothing else is called.
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

async function run(
  action: "revertToDraft" | "revertAndPublish" | "discardDraft" | "publish",
  target: ContentChange,
): Promise<string | null> {
  const { result } = renderHook(() => useChangeActions());
  let outcome: string | null = "unset";
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

    expect(outcome).toBeNull();
    expect(fetchCalls()).toEqual([PUT_REVERT]);
    expect(JSON.parse(fetchCalls()[0].body as string).content).toBe(
      ORDINARY_COPY,
    );
  });

  it("reverts and publishes: the PUT, then a POST for this one element", async () => {
    const outcome = await run("revertAndPublish", row());

    expect(outcome).toBeNull();
    expect(fetchCalls()).toEqual([PUT_REVERT, POST_PUBLISH]);
  });

  it("never publishes when the draft was refused, and returns the 402's own words", async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      response({ error: PLAN_ENDED, reason: "plan_ended" }, 402),
    );

    const outcome = await run("revertAndPublish", row());

    expect(outcome).toBe(PLAN_ENDED);
    expect(fetchCalls()).toEqual([PUT_REVERT]);
  });

  it("returns the publish refusal when the draft saved but the publish did not", async () => {
    (global.fetch as jest.Mock)
      .mockImplementationOnce(async () => response({ success: true }))
      .mockImplementationOnce(async () =>
        response({ error: "Publish permission required" }, 403),
      );

    const outcome = await run("revertAndPublish", row());

    expect(outcome).toBe("Publish permission required");
    expect(fetchCalls()).toEqual([PUT_REVERT, POST_PUBLISH]);
  });

  it("discards a draft with a PUT of the live text", async () => {
    const pending = row({
      state: "pending",
      live: ORDINARY_COPY,
      draft: "Start your 14-day trial",
    });

    const outcome = await run("discardDraft", pending);

    expect(outcome).toBeNull();
    expect(fetchCalls()).toEqual([PUT_REVERT]);
  });

  it("publishes with the POST alone", async () => {
    const outcome = await run(
      "publish",
      row({ state: "pending", draft: "Start now" }),
    );

    expect(outcome).toBeNull();
    expect(fetchCalls()).toEqual([POST_PUBLISH]);
  });

  it("returns the server's words verbatim for a 402 on a single write", async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      response({ error: PLAN_ENDED, reason: "plan_ended" }, 402),
    );

    expect(await run("revertToDraft", row())).toBe(PLAN_ENDED);
    expect(fetchCalls()).toEqual([PUT_REVERT]);
  });

  it("says the write failed when the refusal carries no words", async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      response({}, 500),
    );

    expect(await run("publish", row())).toMatch(/could not publish/i);
  });

  it("sends nothing when the row has no text to go back to", async () => {
    expect(await run("revertToDraft", row({ original: null }))).toMatch(
      /no original/i,
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

    let pending!: Promise<string | null>;
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
