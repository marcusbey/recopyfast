import { act, renderHook } from "@testing-library/react";
import {
  busyActionOf,
  isElementWriting,
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
 *
 * s70b fix pass (M1, C1): Discard sent the live text and links as the page
 * had loaded them, so a stale view (a second tab, an editor publishing from
 * the live page) re-staged old copy. It now reads its row again just before
 * the PUT and builds the PUT from that read, or sends nothing when the draft
 * changed meanwhile. Every write that landed is followed by a re-read of the
 * element, inside the action, so the row is never reported done as it was.
 *
 * Verification of 63d7ba2: every write in flight has its own entry, and a
 * second write to an element being written is refused; a write whose answer
 * never came back is read again, as one that may have landed; the element
 * read pages past 50 rows; a draft on text never published is not discarded.
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
    hasLiveText: true,
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

// A read (Discard's re-read) is a plain `fetch(url)`: no init, so GET.
const fetchCalls = () =>
  (global.fetch as jest.Mock).mock.calls.map(([url, init]) => ({
    url,
    method: (init as RequestInit | undefined)?.method ?? "GET",
    contentType: init
      ? new Headers((init as RequestInit).headers).get("Content-Type")
      : null,
    body: (init as RequestInit | undefined)?.body,
  }));

/** Discard's re-read of its row: every row of the element, as held now. */
const ELEMENT_READ = {
  url: `/api/content/changes?state=all&offset=0&site=${SITE_ID}&element=rcf-1gom2eazz3g`,
  method: "GET",
  contentType: null,
  body: undefined,
};

const UPDATED_ELSEWHERE =
  "This change was updated elsewhere — review it again.";
const NEVER_PUBLISHED =
  "This text was never published, so its draft can't be discarded here. Edit or publish it on the page.";
const ROW_OUT_OF_DATE =
  "The row could not be read again and may be out of date. Reload the page to see it as it is now.";
const lost = (what: string) =>
  `The connection dropped before the server answered, so ${what}. Check the row before trying again.`;
const PUBLISH_LOST = lost("it may or may not have been published");
const REVERT_LOST = lost("the revert may or may not have been saved");
const DISCARD_LOST = lost("the draft may or may not have been discarded");

/** The server answers reads with `rows` and accepts every write. */
function serverHolds(rows: ContentChange[]) {
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) =>
    (init?.method ?? "GET") === "GET"
      ? response({
          sites: [],
          rows,
          total: rows.length,
          counts: { pending: 0, published: 0, original: 0 },
          nextOffset: null,
        })
      : response({ success: true }),
  ) as unknown as typeof fetch;
}

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

  it("discards a draft with a PUT of the live text, after reading its row again", async () => {
    const pending = row({
      state: "pending",
      live: ORDINARY_COPY,
      draft: "Start your 14-day trial",
    });
    serverHolds([pending]);

    const outcome = await run("discardDraft", pending);

    expect(outcome).toEqual(done("discardDraft"));
    expect(fetchCalls()).toEqual([ELEMENT_READ, PUT_REVERT]);
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
    serverHolds([pending]);

    const outcome = await run("discardDraft", pending);

    expect(outcome).toEqual(done("discardDraft"));
    expect(fetchCalls()).toEqual([
      ELEMENT_READ,
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

  // Devin re-review N2 / N4: a pending row whose staged attributes are not
  // known (the list route could not read them: null; or an answer without the
  // field at all, which threw "not iterable" here) may stage a link that a
  // text-only discard leaves staged. It is refused, and nothing is sent.
  it.each([
    ["could not be read (null)", null],
    ["are missing from the row", undefined],
  ])(
    "refuses to discard, sending nothing, when the staged attributes %s",
    async (_label, draftAttributes) => {
      const pending = row({
        state: "pending",
        live: ORDINARY_COPY,
        draft: "Start your 14-day trial",
        draftAttributes: draftAttributes as ContentChange["draftAttributes"],
      });

      expect(await run("discardDraft", pending)).toEqual(
        refused(/could not be read/i),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  // Verification of 63d7ba2 (minor 6): a translation is written with no
  // published text, and "Live now" stands in the original for it. Discard
  // saved that original as the draft, which still differs from the NULL the
  // view compares it with: the row stayed Pending under "Draft discarded."
  it("refuses to discard a draft on text that was never published, sending nothing", async () => {
    const pending = row({
      state: "pending",
      live: ORDINARY_COPY,
      draft: "Essai gratuit de 14 jours",
      hasLiveText: false,
    });

    expect(await run("discardDraft", pending)).toEqual(
      refused(NEVER_PUBLISHED),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // M1: what goes back is what the server holds now, not what the page
  // loaded. Live text and links can move under a pending draft (a bulk
  // update writes published_content without touching the draft), and the
  // PUT must send the current ones or it stages the old ones again.
  it("builds the discard from the row as read just now: its live text and live link", async () => {
    const seen = row({
      state: "pending",
      live: "Start free trial",
      draft: "Start your 14-day trial",
      draftAttributes: [{ name: "href", live: "/signup" }],
    });
    serverHolds([
      row({ id: "row-fr", language: "en", variant: "default" }),
      {
        ...seen,
        live: ORDINARY_COPY,
        draftAttributes: [{ name: "href", live: "/signup?ref=new" }],
      },
    ]);

    const outcome = await run("discardDraft", seen);

    expect(outcome).toEqual(done("discardDraft"));
    expect(fetchCalls()).toEqual([
      ELEMENT_READ,
      {
        ...PUT_REVERT,
        body: JSON.stringify({
          elementId: "rcf-1gom2eazz3g",
          content: ORDINARY_COPY,
          language: "fr",
          variant: "b",
          href: "/signup?ref=new",
        }),
      },
    ]);
  });

  const SEEN = row({
    state: "pending",
    live: ORDINARY_COPY,
    draft: "Start your 14-day trial",
    draftAttributes: [{ name: "href", live: "/signup" }],
  });

  it.each([
    ["was published meanwhile", [{ ...SEEN, state: "published", draft: null }]],
    ["holds another draft now", [{ ...SEEN, draft: "Start your free trial" }]],
    [
      "stages another attribute now",
      [
        {
          ...SEEN,
          draftAttributes: [
            { name: "href", live: "/signup" },
            { name: "alt", live: "Hero" },
          ],
        },
      ],
    ],
    ["is gone", []],
  ])(
    "sends nothing, and says the change was updated elsewhere, when the row %s",
    async (_label, rows) => {
      serverHolds(rows as ContentChange[]);

      const outcome = await run("discardDraft", SEEN);

      expect(outcome).toEqual({
        error: UPDATED_ELSEWHERE,
        applied: null,
        isStale: true,
      });
      expect(fetchCalls()).toEqual([ELEMENT_READ]);
    },
  );

  // Verification of 63d7ba2 (minor 4): the re-read took the element's first
  // 50 rows only. An element has a row per language × variant; a row past
  // the first page was "gone", and its Discard said "updated elsewhere".
  it("finds its row past the element read's first page, and discards it", async () => {
    const siblings = Array.from({ length: 60 }, (_, index) =>
      row({
        id: `row-${index}`,
        language: `l${index}`,
        state: "pending",
        live: ORDINARY_COPY,
        draft: "Start your 14-day trial",
      }),
    );
    const target = siblings[55];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") return response({ success: true });
      const offset = Number(
        new URL(url, "http://localhost").searchParams.get("offset"),
      );
      return response({
        sites: [],
        rows: siblings.slice(offset, offset + 50),
        total: siblings.length,
        counts: { pending: 60, published: 0, original: 0 },
        nextOffset: offset + 50 < siblings.length ? offset + 50 : null,
      });
    }) as unknown as typeof fetch;

    const outcome = await run("discardDraft", target);

    expect(outcome).toEqual(done("discardDraft"));
    expect(fetchCalls()).toEqual([
      ELEMENT_READ,
      {
        ...ELEMENT_READ,
        url: ELEMENT_READ.url.replace("offset=0", "offset=50"),
      },
      {
        ...PUT_REVERT,
        body: JSON.stringify({
          elementId: "rcf-1gom2eazz3g",
          content: ORDINARY_COPY,
          language: "l55",
          variant: "b",
        }),
      },
    ]);
  });

  it("sends nothing when the row as read now has no live text of its own, and says why", async () => {
    serverHolds([{ ...SEEN, hasLiveText: false }]);

    const outcome = await run("discardDraft", SEEN);

    expect(outcome).toEqual({
      error: NEVER_PUBLISHED,
      applied: null,
      isStale: true,
    });
    expect(fetchCalls()).toEqual([ELEMENT_READ]);
  });

  it("sends nothing when the staged attributes cannot be read now, and says why", async () => {
    serverHolds([{ ...SEEN, draftAttributes: null }]);

    const outcome = await run("discardDraft", SEEN);

    expect(outcome).toEqual({
      error:
        "This draft could not be read in full, so it can't be discarded here. Reload the page to try again.",
      applied: null,
      isStale: true,
    });
    expect(fetchCalls()).toEqual([ELEMENT_READ]);
  });

  it("sends nothing when the row cannot be read again before the discard", async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      response({ error: "Failed to load changes" }, 500),
    );

    const outcome = await run("discardDraft", SEEN);

    expect(outcome).toEqual(refused(/could not check this draft/i));
    expect(fetchCalls()).toEqual([ELEMENT_READ]);
  });

  describe("the re-read after a write", () => {
    async function runWithReread(
      action: ChangeAction,
      target: ContentChange,
      reread: jest.Mock,
    ): Promise<ActionOutcome | null> {
      const { result } = renderHook(() => useChangeActions({ reread }));
      let outcome: ActionOutcome | null = null;
      await act(async () => {
        outcome = await result.current[action](target);
      });
      return outcome;
    }

    it("re-reads the row's element after the write lands, and keeps the row busy until it has", async () => {
      let finish!: (isFresh: boolean) => void;
      const reread = jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      );
      const target = row({ state: "pending", draft: "Start now" });
      const { result } = renderHook(() => useChangeActions({ reread }));

      let pending!: Promise<ActionOutcome>;
      act(() => {
        pending = result.current.publish(target);
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(reread).toHaveBeenCalledWith(target);
      expect(busyActionOf(result.current.inFlight, target)).toBe("publish");

      let outcome: ActionOutcome | null = null;
      await act(async () => {
        finish(true);
        outcome = await pending;
      });
      expect(outcome).toEqual(done("publish"));
      expect(busyActionOf(result.current.inFlight, target)).toBeNull();
    });

    it("re-reads after a revert whose publish failed: its draft landed", async () => {
      (global.fetch as jest.Mock)
        .mockImplementationOnce(async () => response({ success: true }))
        .mockImplementationOnce(async () =>
          response(
            { error: "Publish rate limit exceeded for this site." },
            429,
          ),
        );
      const reread = jest.fn(async () => true);

      const outcome = await runWithReread("revertAndPublish", row(), reread);

      expect(outcome?.applied).toBe("revertToDraft");
      expect(reread).toHaveBeenCalledTimes(1);
    });

    it("re-reads a row its discard found changed elsewhere, so the page shows it as it is", async () => {
      serverHolds([{ ...SEEN, draft: "Start your free trial" }]);
      const reread = jest.fn(async () => true);

      const outcome = await runWithReread("discardDraft", SEEN, reread);

      expect(outcome?.error).toBe(UPDATED_ELSEWHERE);
      expect(reread).toHaveBeenCalledWith(SEEN);
    });

    it("reads nothing again after a write that was refused", async () => {
      (global.fetch as jest.Mock).mockImplementation(async () =>
        response({ error: PLAN_ENDED, reason: "plan_ended" }, 402),
      );
      const reread = jest.fn(async () => true);

      expect(await runWithReread("revertToDraft", row(), reread)).toEqual(
        refused(PLAN_ENDED),
      );
      expect(reread).not.toHaveBeenCalled();
    });

    // Verification of 63d7ba2 (minor 5): "review it again" was shown over a
    // row that could not be read again, as if what it showed were current.
    it("says a row its discard found changed elsewhere may be out of date when it cannot be read again", async () => {
      serverHolds([{ ...SEEN, draft: "Start your free trial" }]);
      const reread = jest.fn(async () => false);

      const outcome = await runWithReread("discardDraft", SEEN, reread);

      expect(outcome).toEqual({
        error: `${UPDATED_ELSEWHERE} ${ROW_OUT_OF_DATE}`,
        applied: null,
        isStale: true,
      });
      expect(reread).toHaveBeenCalledWith(SEEN);
    });

    // Verification of 63d7ba2 (minor 5): a write whose answer never came
    // back (the connection dropped) was reported as refused and not read
    // again, though it may have landed: the row could show a draft the
    // server had published, or discarded.
    describe("when a write's answer is lost", () => {
      const LOST = () => Promise.reject(new TypeError("Failed to fetch"));
      const PENDING = row({
        state: "pending",
        live: ORDINARY_COPY,
        draft: "Start your 14-day trial",
      });

      it.each([
        [
          "publish",
          PENDING,
          {
            error: PUBLISH_LOST,
            applied: null,
            isUncertain: true,
          },
          [POST_PUBLISH],
        ],
        [
          "revertToDraft",
          row(),
          {
            error: REVERT_LOST,
            applied: null,
            isUncertain: true,
          },
          [PUT_REVERT],
        ],
        [
          // Never publishes a draft whose save was not confirmed.
          "revertAndPublish",
          row(),
          {
            error: REVERT_LOST,
            applied: null,
            isUncertain: true,
          },
          [PUT_REVERT],
        ],
      ] as const)(
        "%s reads the row again and says it may or may not have landed",
        async (action, target, expected, calls) => {
          (global.fetch as jest.Mock).mockImplementation(LOST);
          const reread = jest.fn(async () => true);

          const outcome = await runWithReread(action, target, reread);

          expect(outcome).toEqual(expected);
          expect(fetchCalls()).toEqual(calls);
          expect(reread).toHaveBeenCalledWith(target);
        },
      );

      it("reads a discard whose PUT's answer was lost again, and says the draft may or may not be gone", async () => {
        serverHolds([PENDING]);
        const reads = global.fetch as jest.Mock;
        const answer = reads.getMockImplementation()!;
        reads.mockImplementation((url: string, init?: RequestInit) =>
          init?.method === "PUT" ? LOST() : answer(url, init),
        );
        const reread = jest.fn(async () => true);

        const outcome = await runWithReread("discardDraft", PENDING, reread);

        expect(outcome).toEqual({
          error: DISCARD_LOST,
          applied: null,
          isUncertain: true,
        });
        expect(fetchCalls().map(({ method }) => method)).toEqual([
          "GET",
          "PUT",
        ]);
        expect(reread).toHaveBeenCalledWith(PENDING);
      });

      it("says a revert landed as a draft when its publish's answer was lost", async () => {
        (global.fetch as jest.Mock)
          .mockImplementationOnce(async () => response({ success: true }))
          .mockImplementationOnce(LOST);
        const reread = jest.fn(async () => true);

        const outcome = await runWithReread("revertAndPublish", row(), reread);

        expect(outcome).toEqual({
          error: `The revert was saved as a draft. ${PUBLISH_LOST}`,
          applied: "revertToDraft",
        });
        expect(fetchCalls()).toEqual([PUT_REVERT, POST_PUBLISH]);
        expect(reread).toHaveBeenCalledTimes(1);
      });

      it("says the row may be out of date when it cannot be read again either", async () => {
        (global.fetch as jest.Mock).mockImplementation(LOST);
        const reread = jest.fn(async () => false);

        const outcome = await runWithReread("publish", PENDING, reread);

        expect(outcome).toEqual({
          error: `${PUBLISH_LOST} ${ROW_OUT_OF_DATE}`,
          applied: null,
          isUncertain: true,
        });
      });
    });

    it("says the write went through but the row may be out of date when it cannot be read again", async () => {
      const reread = jest.fn(async () => false);

      const outcome = await runWithReread(
        "publish",
        row({ state: "pending", draft: "Start now" }),
        reread,
      );

      expect(outcome).toEqual({
        error:
          "This went through, but the row could not be read again and may be out of date. Reload the page to see it as it is now.",
        applied: "publish",
      });
    });
  });

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
    const target = row();

    let pending!: Promise<ActionOutcome>;
    act(() => {
      pending = result.current.publish(target);
    });
    expect(busyActionOf(result.current.inFlight, target)).toBe("publish");
    expect(isElementWriting(result.current.inFlight, target)).toBe(true);

    await act(async () => {
      finish(response({ success: true }));
      await pending;
    });
    expect(result.current.inFlight).toEqual([]);
    expect(busyActionOf(result.current.inFlight, target)).toBeNull();
  });

  // Verification of 63d7ba2 (major): one slot held "the" write in flight, so
  // a second write replaced the first one's busy state and whichever ended
  // first cleared both. Each write now has its own entry.
  describe("one write at a time per element", () => {
    function heldFetches() {
      const answers: Array<(value: Response) => void> = [];
      (global.fetch as jest.Mock).mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            answers.push(resolve);
          }),
      );
      return answers;
    }

    it("tracks every write in flight, and a write's end clears only its own", async () => {
      const answers = heldFetches();
      const first = row({ id: "row-a", elementId: "rcf-a", state: "pending" });
      const second = row({ id: "row-b", elementId: "rcf-b", state: "pending" });
      const { result } = renderHook(() => useChangeActions());

      let firstDone!: Promise<ActionOutcome>;
      let secondDone!: Promise<ActionOutcome>;
      act(() => {
        firstDone = result.current.publish(first);
      });
      act(() => {
        secondDone = result.current.publish(second);
      });
      expect(busyActionOf(result.current.inFlight, first)).toBe("publish");
      expect(busyActionOf(result.current.inFlight, second)).toBe("publish");

      await act(async () => {
        answers[0](response({ success: true }));
        await firstDone;
      });
      expect(busyActionOf(result.current.inFlight, first)).toBeNull();
      expect(busyActionOf(result.current.inFlight, second)).toBe("publish");
      expect(isElementWriting(result.current.inFlight, second)).toBe(true);

      await act(async () => {
        answers[1](response({ success: true }));
        await secondDone;
      });
      expect(result.current.inFlight).toEqual([]);
    });

    it("locks every language and variant row of the element, and no other element", async () => {
      heldFetches();
      const en = row({ id: "row-en", language: "en", state: "pending" });
      const fr = row({ id: "row-fr", language: "fr", state: "pending" });
      const otherSite = row({ id: "row-x", siteId: "other-site" });
      const otherElement = row({ id: "row-y", elementId: "rcf-other" });
      const { result } = renderHook(() => useChangeActions());

      act(() => {
        void result.current.publish(en);
      });

      expect(isElementWriting(result.current.inFlight, fr)).toBe(true);
      expect(busyActionOf(result.current.inFlight, fr)).toBeNull();
      expect(isElementWriting(result.current.inFlight, otherSite)).toBe(false);
      expect(isElementWriting(result.current.inFlight, otherElement)).toBe(
        false,
      );
    });

    it("refuses a second write to an element while one is in flight, sending nothing", async () => {
      heldFetches();
      const en = row({
        id: "row-en",
        language: "en",
        state: "pending",
        draft: "Start your 14-day trial",
      });
      const fr = row({
        id: "row-fr",
        state: "pending",
        live: ORDINARY_COPY,
        draft: "Essai gratuit de 14 jours",
      });
      const { result } = renderHook(() => useChangeActions());

      act(() => {
        void result.current.publish(en);
      });
      let outcome: ActionOutcome | null = null;
      await act(async () => {
        outcome = await result.current.discardDraft(fr);
      });

      expect(outcome).toEqual(refused(/still being saved/i));
      expect(fetchCalls()).toEqual([POST_PUBLISH]);
      expect(busyActionOf(result.current.inFlight, fr)).toBeNull();
      expect(busyActionOf(result.current.inFlight, en)).toBe("publish");
    });
  });
});
