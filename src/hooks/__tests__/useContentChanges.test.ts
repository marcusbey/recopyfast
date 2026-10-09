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

  it("updates one row in place and moves its count with it", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        response(page([change("a", { state: "published" }), change("b")])),
      ) as typeof fetch;
    const { result } = renderHook(() => useContentChanges(DEFAULT_FILTERS));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    act(() => {
      result.current.updateRow("a", { state: "pending", draft: "Original" });
    });

    expect(result.current.data?.rows.map((row) => [row.id, row.state])).toEqual(
      [
        ["a", "pending"],
        ["b", "published"],
      ],
    );
    expect(result.current.data?.rows[0].draft).toBe("Original");
    expect(result.current.data?.counts).toEqual({
      pending: 2,
      published: 1,
      original: 3,
    });
  });
});
