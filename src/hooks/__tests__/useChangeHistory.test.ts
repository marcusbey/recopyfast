import { renderHook, waitFor } from "@testing-library/react";
import { useChangeHistory } from "../useChangeHistory";

/**
 * s70b — a row's history is read on its first expand and kept for the page's
 * lifetime (design, Performance): collapsing and expanding again, or opening
 * another row and coming back, asks the server nothing. A row whose change
 * moved on (a revert, a publish) is a new version and is read again. A
 * refused read is an error, never an empty history.
 */

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const HISTORY = {
  historyVisible: true,
  discoveredAt: "2026-09-28T09:00:00+00:00",
  events: [
    {
      id: "h1",
      action: "publish",
      by: "ana@example.com",
      at: "2026-10-08T10:00:00+00:00",
      previous: "Old",
      content: "New",
    },
  ],
};

let rowCounter = 0;
const uniqueRow = () => `row-${(rowCounter += 1)}`;

describe("useChangeHistory", () => {
  beforeEach(() => {
    global.fetch = jest
      .fn()
      .mockImplementation(async () => response(HISTORY)) as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it("reads nothing while no row is open", () => {
    const { result } = renderHook(() => useChangeHistory(null, null));

    expect(result.current).toEqual(
      expect.objectContaining({ data: null, loading: false, error: null }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("loads a row's history once and serves it from the cache after", async () => {
    const rowA = uniqueRow();
    const rowB = uniqueRow();
    const { result, rerender, unmount } = renderHook(
      ({ rowId }: { rowId: string }) => useChangeHistory(rowId, "v1"),
      { initialProps: { rowId: rowA } },
    );
    await waitFor(() => expect(result.current.data).toEqual(HISTORY));
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/content/changes/${rowA}/history`,
    );

    rerender({ rowId: rowA });
    rerender({ rowId: rowB });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    rerender({ rowId: rowA });
    expect(result.current.data).toEqual(HISTORY);
    unmount();

    // Collapsed and expanded again: a fresh mount, the same row and version.
    const again = renderHook(() => useChangeHistory(rowA, "v1"));
    expect(again.result.current.data).toEqual(HISTORY);
    expect(again.result.current.loading).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("reads again when the row's change moved on", async () => {
    const row = uniqueRow();
    const { result, rerender } = renderHook(
      ({ version }: { version: string }) => useChangeHistory(row, version),
      { initialProps: { version: "2026-10-08T10:00:00Z" } },
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());

    rerender({ version: "2026-10-09T08:00:00Z" });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it("reports a refused read as an error, never an empty history, and caches nothing", async () => {
    const row = uniqueRow();
    (global.fetch as jest.Mock).mockImplementation(async () =>
      response({ error: "Failed to load history" }, 500),
    );

    const { result, unmount } = renderHook(() => useChangeHistory(row, "v1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to load history");
    expect(result.current.data).toBeNull();
    unmount();

    (global.fetch as jest.Mock).mockImplementation(async () =>
      response(HISTORY),
    );
    const retry = renderHook(() => useChangeHistory(row, "v1"));
    await waitFor(() => expect(retry.result.current.data).toEqual(HISTORY));
  });
});
