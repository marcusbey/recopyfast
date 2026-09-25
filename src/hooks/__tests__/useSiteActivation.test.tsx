import { act, renderHook, waitFor } from "@testing-library/react";
import { useSiteActivation } from "../useSiteActivation";

const SITE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SITE_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function response(body: Record<string, unknown>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("useSiteActivation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("loads progress and reports non-ok responses as errors", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        response({
          installed: true,
          invited: false,
          published: false,
          dismissed: false,
        }),
      )
      .mockResolvedValueOnce(response({ error: "broken" }, 500));
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() =>
      useSiteActivation({ siteId: SITE_A, userId: "user-a" }),
    );
    await waitFor(() => expect(result.current.data?.installed).toBe(true));

    await act(async () => result.current.refresh());

    expect(result.current.error).toMatch(/could not load activation/i);
    expect(result.current.data).toBeNull();
  });

  it("ignores a late response after the user or site changes", async () => {
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(
        response({
          installed: false,
          invited: true,
          published: false,
          dismissed: false,
        }),
      );
    global.fetch = fetchMock as typeof fetch;

    const { result, rerender } = renderHook(
      ({ siteId, userId }) => useSiteActivation({ siteId, userId }),
      { initialProps: { siteId: SITE_A, userId: "user-a" } },
    );
    rerender({ siteId: SITE_B, userId: "user-b" });
    await waitFor(() => expect(result.current.data?.invited).toBe(true));

    await act(async () => {
      resolveFirst(
        response({
          installed: true,
          invited: false,
          published: true,
          dismissed: false,
        }),
      );
      await first;
    });

    expect(result.current.data).toEqual({
      installed: false,
      invited: true,
      published: false,
      dismissed: false,
    });
  });

  it("persists dismissal on the server and updates only after success", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        response({
          installed: false,
          invited: false,
          published: false,
          dismissed: false,
        }),
      )
      .mockResolvedValueOnce(response({ dismissed: true }));
    global.fetch = fetchMock as typeof fetch;
    const { result } = renderHook(() =>
      useSiteActivation({ siteId: SITE_A, userId: "user-a" }),
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => result.current.dismiss());

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/sites/${SITE_A}/activation`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.data?.dismissed).toBe(true);
  });

  it("does not let an older GET undo a successful dismissal", async () => {
    let resolveRefresh!: (value: Response) => void;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        response({
          installed: false,
          invited: false,
          published: false,
          dismissed: false,
        }),
      )
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        }),
      )
      .mockResolvedValueOnce(response({ dismissed: true }));
    global.fetch = fetchMock as typeof fetch;
    const { result } = renderHook(() =>
      useSiteActivation({ siteId: SITE_A, userId: "user-a" }),
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());

    void result.current.refresh();
    await act(async () => result.current.dismiss());
    await act(async () => {
      resolveRefresh(
        response({
          installed: false,
          invited: false,
          published: false,
          dismissed: false,
        }),
      );
    });

    expect(result.current.data?.dismissed).toBe(true);
  });

  it("refreshes an incomplete visible checklist when focus returns", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response({
        installed: false,
        invited: false,
        published: false,
        dismissed: false,
      }),
    );
    global.fetch = fetchMock as typeof fetch;
    const { result } = renderHook(() =>
      useSiteActivation({ siteId: SITE_A, userId: "user-a" }),
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());

    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
