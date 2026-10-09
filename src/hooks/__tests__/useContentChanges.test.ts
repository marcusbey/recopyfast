import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useContentChanges,
  type ChangesFilters,
  type ContentChange,
} from "../useContentChanges";

/**
 * s70b — the Changes page's server state (AGENTS.md § React: `useState` +
 * `useEffect` + `fetch`, `{ data, loading, error, refetch }`).
 *
 * Pinned: "Show 50 more" appends without duplicating a row the server moved
 * between pages; a filter change starts again at offset 0 and an answer to the
 * old filter, arriving late, never overwrites the new one; a refused read is
 * an error, never an empty list (the `useSites.ts` rule: an empty list reads as
 * "you have no changes" when the truth is "we failed"); typing in search waits
 * 250 ms before it asks.
 */

const SITE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function change(id: string, overrides: Partial<ContentChange> = {}) {
  return {
    id,
    siteId: SITE_A,
    elementId: `rcf-${id}`,
    pagePath: "/",
    elementType: "h1",
    selector: "#root > h1",
    language: "en",
    variant: "default",
    original: "Original",
    live: "Live",
    draft: null,
    state: "published",
    changedAt: "2026-10-08T10:00:00+00:00",
    changedBy: null,
    createdAt: "2026-09-28T09:00:00+00:00",
    ...overrides,
  } as ContentChange;
}

function page(
  rows: ContentChange[],
  { nextOffset = null as number | null, total = rows.length } = {},
) {
  return {
    sites: [
      { id: SITE_A, name: "Acme", domain: "acme.example", permission: "admin" },
    ],
    rows,
    total,
    counts: { pending: 1, published: 2, original: 3 },
    nextOffset,
  };
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const DEFAULT_FILTERS: ChangesFilters = { site: null, state: "changes", q: "" };

function requestedUrl(call: number): URL {
  const [url] = (global.fetch as jest.Mock).mock.calls[call];
  return new URL(String(url), "http://localhost");
}

describe("useContentChanges", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("loads the first page of the default filter", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(response(page([change("a")]))) as typeof fetch;

    const { result } = renderHook(() => useContentChanges(DEFAULT_FILTERS));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data?.rows.map((row) => row.id)).toEqual(["a"]);
    const url = requestedUrl(0);
    expect(url.pathname).toBe("/api/content/changes");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      state: "changes",
      offset: "0",
    });
  });

  it("appends the next page on loadMore and de-duplicates by id", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        response(page([change("a"), change("b")], { nextOffset: 2, total: 4 })),
      )
      .mockResolvedValueOnce(
        response(
          // "b" moved down a page between the two reads.
          page([change("b"), change("c"), change("d")], { total: 4 }),
        ),
      ) as typeof fetch;
    const { result } = renderHook(() => useContentChanges(DEFAULT_FILTERS));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.loadMore();
    });

    expect(requestedUrl(1).searchParams.get("offset")).toBe("2");
    expect(result.current.data?.rows.map((row) => row.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(result.current.data?.nextOffset).toBeNull();
  });

  it("starts again at offset 0 when a filter changes, and drops the old filter's late answer", async () => {
    let answerOld!: (value: Response) => void;
    global.fetch = jest
      .fn()
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          answerOld = resolve;
        }),
      )
      .mockResolvedValueOnce(
        response(page([change("pending-1", { state: "pending" })])),
      ) as typeof fetch;
    const { result, rerender } = renderHook(
      (filters: ChangesFilters) => useContentChanges(filters),
      { initialProps: DEFAULT_FILTERS },
    );

    rerender({ ...DEFAULT_FILTERS, state: "pending" });
    await waitFor(() =>
      expect(result.current.data?.rows.map((row) => row.id)).toEqual([
        "pending-1",
      ]),
    );
    await act(async () => {
      answerOld(response(page([change("stale")])));
    });

    expect(requestedUrl(1).searchParams.get("state")).toBe("pending");
    expect(requestedUrl(1).searchParams.get("offset")).toBe("0");
    expect(result.current.data?.rows.map((row) => row.id)).toEqual([
      "pending-1",
    ]);
  });

  // s70b review M1: the reload emptied everything, and the filter bar draws
  // its site select and status counts from it, so picking a site unmounted
  // the select under the owner's hand (focus lost) and blanked the counts.
  it("keeps the sites and the status counts while a filter change reloads the list", async () => {
    let answerNew!: (value: Response) => void;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(page([change("a")])))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          answerNew = resolve;
        }),
      ) as typeof fetch;
    const { result, rerender } = renderHook(
      (filters: ChangesFilters) => useContentChanges(filters),
      { initialProps: DEFAULT_FILTERS },
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const sitesBefore = page([]).sites;

    rerender({ ...DEFAULT_FILTERS, site: SITE_A });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    // The rows reload; the frame around them does not.
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.sites).toEqual(sitesBefore);
    expect(result.current.counts).toEqual({
      pending: 1,
      published: 2,
      original: 3,
    });

    await act(async () => {
      answerNew(
        response({
          ...page([change("b")]),
          counts: { pending: 0, published: 1, original: 0 },
        }),
      );
    });
    expect(result.current.counts).toEqual({
      pending: 0,
      published: 1,
      original: 0,
    });
    expect(result.current.data?.rows.map((row) => row.id)).toEqual(["b"]);
  });

  it.each([
    [500, { error: "Failed to load changes" }, "Failed to load changes"],
    [401, {}, "Failed to load changes (401)"],
  ])(
    "reports a %s answer as an error, never as an empty list",
    async (status, body, message) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(response(body, status)) as typeof fetch;

      const { result } = renderHook(() => useContentChanges(DEFAULT_FILTERS));

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe(message);
      expect(result.current.data).toBeNull();
    },
  );

  it("reports a body without rows as an error", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(response({ sites: [] })) as typeof fetch;

    const { result } = renderHook(() => useContentChanges(DEFAULT_FILTERS));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/unexpected response/i);
    expect(result.current.data).toBeNull();
  });

  // Devin re-review N4: a row without `draftAttributes` reached the page as
  // `undefined`, and Discard's check threw "not iterable" while drawing it.
  // A list that is missing or malformed is read as not known (null), which
  // the page never offers to discard — never as `[]`, "stages nothing".
  it("reads a missing or malformed attribute list as not known, and keeps a valid one", async () => {
    const valid = [
      { name: "href", live: "/signup" },
      { name: "alt", live: null },
    ];
    const rows = [
      change("missing", { state: "pending", draft: "Draft" }),
      { ...change("null"), draftAttributes: null },
      { ...change("string"), draftAttributes: "href" },
      { ...change("hole"), draftAttributes: [null] },
      { ...change("nameless"), draftAttributes: [{ live: "/signup" }] },
      { ...change("valid"), draftAttributes: valid },
      { ...change("empty"), draftAttributes: [] },
    ] as unknown as ContentChange[];
    global.fetch = jest
      .fn()
      .mockResolvedValue(response(page(rows))) as typeof fetch;

    const { result } = renderHook(() => useContentChanges(DEFAULT_FILTERS));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(
      result.current.data?.rows.map((row) => [row.id, row.draftAttributes]),
    ).toEqual([
      ["missing", null],
      ["null", null],
      ["string", null],
      ["hole", null],
      ["nameless", null],
      ["valid", valid],
      ["empty", []],
    ]);
  });

  it("refetch recovers from an error", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response({ error: "Failed to load changes" }, 500))
      .mockResolvedValueOnce(response(page([change("a")]))) as typeof fetch;
    const { result } = renderHook(() => useContentChanges(DEFAULT_FILTERS));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data?.rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("waits 250 ms after typing before it searches, and sends the search once", async () => {
    jest.useFakeTimers();
    global.fetch = jest
      .fn()
      .mockImplementation(async () => response(page([]))) as typeof fetch;
    const { rerender } = renderHook(
      (filters: ChangesFilters) => useContentChanges(filters),
      { initialProps: DEFAULT_FILTERS },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    rerender({ ...DEFAULT_FILTERS, q: "pri" });
    rerender({ ...DEFAULT_FILTERS, q: "pricing" });
    await act(async () => {
      jest.advanceTimersByTime(249);
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(requestedUrl(1).searchParams.get("q")).toBe("pricing");
    expect(requestedUrl(1).searchParams.get("offset")).toBe("0");
  });

  it("sends the site when one is named", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(response(page([]))) as typeof fetch;

    renderHook(() => useContentChanges({ ...DEFAULT_FILTERS, site: SITE_A }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(requestedUrl(0).searchParams.get("site")).toBe(SITE_A);
  });

  // s70b fix pass (C1, CTO decision): the page no longer derives what a write
  // left on the server. Publish promotes every language and variant row of
  // an element_id, and the row drawn "in place" left its fr sibling showing
  // its old draft, with a Discard that re-staged it. After any write, every
  // row of the element is read again, and the counts with them.
  describe("refreshAfterWrite", () => {
    const EN_BEFORE = change("e-en", {
      elementId: "rcf-e",
      state: "pending",
      draft: "Hello",
      live: "Hi",
    });
    const FR_BEFORE = change("e-fr", {
      elementId: "rcf-e",
      language: "fr",
      state: "pending",
      draft: "Bonjour",
      live: "Salut",
    });
    const EN_AFTER = change("e-en", {
      elementId: "rcf-e",
      state: "published",
      live: "Hello",
    });
    const FR_AFTER = change("e-fr", {
      elementId: "rcf-e",
      language: "fr",
      state: "published",
      live: "Bonjour",
    });
    const OTHER = change("x", { state: "published" });
    const COUNTS_AFTER = { pending: 0, published: 3, original: 3 };

    function route(answer: (url: URL) => Response | Promise<Response>) {
      global.fetch = jest.fn(async (input: RequestInfo | URL) =>
        answer(new URL(String(input), "http://localhost")),
      ) as unknown as typeof fetch;
    }
    const requests = () =>
      (global.fetch as jest.Mock).mock.calls.map(
        ([input]) => new URL(String(input), "http://localhost"),
      );
    const isElementRead = (url: URL) => url.searchParams.has("element");
    const shown = (rows: ContentChange[] | undefined) =>
      rows?.map((row) => [row.id, row.state, row.live]);

    it("re-reads every loaded row of the element, siblings included, and takes the counts and total from a fresh read", async () => {
      let written = false;
      route((url) => {
        if (isElementRead(url)) return response(page([EN_AFTER, FR_AFTER]));
        return written
          ? response({ ...page([OTHER], { total: 3 }), counts: COUNTS_AFTER })
          : response(page([EN_BEFORE, OTHER, FR_BEFORE], { total: 3 }));
      });
      const { result } = renderHook(() => useContentChanges(DEFAULT_FILTERS));
      await waitFor(() => expect(result.current.data).not.toBeNull());

      written = true;
      let isFresh: boolean | undefined;
      await act(async () => {
        isFresh = await result.current.refreshAfterWrite(SITE_A, "rcf-e");
      });

      expect(isFresh).toBe(true);
      const elementRead = requests().find(isElementRead);
      expect(Object.fromEntries(elementRead!.searchParams)).toEqual({
        site: SITE_A,
        element: "rcf-e",
        state: "all",
        offset: "0",
      });
      expect(shown(result.current.data?.rows)).toEqual([
        ["e-en", "published", "Hello"],
        ["x", "published", "Live"],
        ["e-fr", "published", "Bonjour"],
      ]);
      expect(result.current.data?.counts).toEqual(COUNTS_AFTER);
      expect(result.current.counts).toEqual(COUNTS_AFTER);
    });

    it("resolves false when the element cannot be read again, and leaves the rows as they were", async () => {
      let written = false;
      route((url) =>
        written && isElementRead(url)
          ? response({ error: "Failed to load changes" }, 500)
          : response(page([EN_BEFORE, FR_BEFORE])),
      );
      const { result } = renderHook(() => useContentChanges(DEFAULT_FILTERS));
      await waitFor(() => expect(result.current.data).not.toBeNull());

      written = true;
      let isFresh: boolean | undefined;
      await act(async () => {
        isFresh = await result.current.refreshAfterWrite(SITE_A, "rcf-e");
      });

      expect(isFresh).toBe(false);
      expect(shown(result.current.data?.rows)).toEqual([
        ["e-en", "pending", "Hi"],
        ["e-fr", "pending", "Salut"],
      ]);
    });

    // Review m1: a filter changed while Publish was in flight emptied the
    // list, so the in-place patch found no row and was dropped; the reload,
    // read before the publish committed, then drew the row as Pending with
    // Discard offered. A first page still in flight when the write lands is
    // asked for again, and its older answer is dropped.
    it("asks again for a filter reload in flight when the write landed, and drops its older answer", async () => {
      let written = false;
      let answerOld: (() => void) | null = null;
      route((url) => {
        // Each answer is what the server held when the read reached it.
        const body = page([written ? EN_AFTER : EN_BEFORE]);
        if (url.searchParams.get("state") === "pending" && !answerOld) {
          return new Promise<Response>((resolve) => {
            answerOld = () => resolve(response(body));
          });
        }
        return response(body);
      });
      const { result, rerender } = renderHook(
        (filters: ChangesFilters) => useContentChanges(filters),
        { initialProps: DEFAULT_FILTERS },
      );
      await waitFor(() => expect(result.current.data).not.toBeNull());
      rerender({ ...DEFAULT_FILTERS, state: "pending" });
      await waitFor(() => expect(answerOld).not.toBeNull());

      written = true;
      await act(async () => {
        await result.current.refreshAfterWrite(SITE_A, "rcf-e");
      });
      await waitFor(() =>
        expect(shown(result.current.data?.rows)).toEqual([
          ["e-en", "published", "Hello"],
        ]),
      );
      await act(async () => {
        answerOld!();
      });

      expect(
        requests().filter(
          (url) =>
            url.searchParams.get("state") === "pending" && !isElementRead(url),
        ),
      ).toHaveLength(2);
      expect(shown(result.current.data?.rows)).toEqual([
        ["e-en", "published", "Hello"],
      ]);
    });

    it("never draws a re-read row as it was when an older Show 50 more lands after it, nor takes its older counts", async () => {
      let written = false;
      let answerMore: (() => void) | null = null;
      route((url) => {
        if (isElementRead(url)) return response(page([EN_AFTER, FR_AFTER]));
        if (url.searchParams.get("offset") === "1") {
          // Read before the write: the fr sibling still pending.
          const body = page([FR_BEFORE], { total: 2 });
          return new Promise<Response>((resolve) => {
            answerMore = () => resolve(response(body));
          });
        }
        return written
          ? response({ ...page([OTHER], { total: 2 }), counts: COUNTS_AFTER })
          : response(page([OTHER], { nextOffset: 1, total: 2 }));
      });
      const { result } = renderHook(() => useContentChanges(DEFAULT_FILTERS));
      await waitFor(() => expect(result.current.data).not.toBeNull());
      let more!: Promise<void>;
      act(() => {
        more = result.current.loadMore();
      });
      await waitFor(() => expect(answerMore).not.toBeNull());

      written = true;
      await act(async () => {
        await result.current.refreshAfterWrite(SITE_A, "rcf-e");
      });
      await act(async () => {
        answerMore!();
        await more;
      });

      expect(shown(result.current.data?.rows)).toEqual([
        ["x", "published", "Live"],
        ["e-fr", "published", "Bonjour"],
      ]);
      expect(result.current.data?.counts).toEqual(COUNTS_AFTER);
    });

    it("keeps the row a newer read drew when an older re-read lands after it", async () => {
      const EN_NEWER = change("e-en", {
        elementId: "rcf-e",
        state: "published",
        live: "Hello again",
      });
      let answerReread: (() => void) | null = null;
      route((url) => {
        if (isElementRead(url)) {
          return new Promise<Response>((resolve) => {
            answerReread = () => resolve(response(page([EN_AFTER])));
          });
        }
        return url.searchParams.get("state") === "published"
          ? response(page([EN_NEWER]))
          : response(page([EN_BEFORE]));
      });
      const { result, rerender } = renderHook(
        (filters: ChangesFilters) => useContentChanges(filters),
        { initialProps: DEFAULT_FILTERS },
      );
      await waitFor(() => expect(result.current.data).not.toBeNull());
      let reread!: Promise<boolean>;
      act(() => {
        reread = result.current.refreshAfterWrite(SITE_A, "rcf-e");
      });
      await waitFor(() => expect(answerReread).not.toBeNull());

      rerender({ ...DEFAULT_FILTERS, state: "published" });
      await waitFor(() =>
        expect(shown(result.current.data?.rows)).toEqual([
          ["e-en", "published", "Hello again"],
        ]),
      );
      await act(async () => {
        answerReread!();
        await reread;
      });

      expect(shown(result.current.data?.rows)).toEqual([
        ["e-en", "published", "Hello again"],
      ]);
    });
  });
});
