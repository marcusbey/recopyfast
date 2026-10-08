import { act, renderHook } from "@testing-library/react";
import { useEditSession } from "../useEditSession";

/**
 * s66c1 AC 4 — one way to start an edit session, extracted from the activation
 * checklist (ActivationChecklist.test.tsx:393-480, ported).
 *
 * Every "Edit website" control (the Sites row and its menu, the site header,
 * the checklist step) goes through this hook, so its four promises are pinned
 * here once: the tab opens on the click itself, the request carries exactly
 * the caller's body, only a link to the registered site is opened, and every
 * failure closes the tab and comes back as a message.
 */

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOMAIN = "client.example.com";
const REQUEST = {
  siteId: SITE_ID,
  permissions: ["edit", "publish"] as const,
  durationHours: 2,
};

const popup = {
  opener: {} as Window | null,
  location: { href: "" },
  close: jest.fn(),
};

function respondWith(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    json: async () => body,
  }) as jest.MockedFunction<typeof fetch>;
}

describe("useEditSession", () => {
  beforeEach(() => {
    popup.opener = {} as Window;
    popup.location.href = "";
    popup.close.mockReset();
    jest.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  });

  afterEach(() => jest.restoreAllMocks());

  // Browsers tie pop-up permission to the synchronous click. Opening only
  // after the round trip turned a healthy response into a blocked pop-up.
  it("opens the tab before the session request resolves", async () => {
    let resolveRequest!: (value: Response) => void;
    global.fetch = jest.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    ) as jest.MockedFunction<typeof fetch>;
    const { result } = renderHook(() => useEditSession(DOMAIN));

    let pending!: Promise<string | null>;
    act(() => {
      pending = result.current.openEditSession(REQUEST);
    });

    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.location.href).toBe("");
    expect(result.current.isOpening).toBe(true);

    await act(async () => {
      resolveRequest({
        ok: true,
        json: async () => ({ editUrl: "https://client.example.com/edit" }),
      } as Response);
      await pending;
    });

    expect(popup.location.href).toBe("https://client.example.com/edit");
    expect(popup.opener).toBeNull();
    expect(result.current.isOpening).toBe(false);
  });

  it("posts exactly the body it was given", async () => {
    respondWith({ editUrl: "https://client.example.com/edit" });
    const { result } = renderHook(() => useEditSession(DOMAIN));

    await act(async () => {
      await result.current.openEditSession(REQUEST);
    });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/edit-sessions/create");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      siteId: SITE_ID,
      permissions: ["edit", "publish"],
      durationHours: 2,
    });
  });

  it("opens only the returned http(s) URL on the registered host", async () => {
    respondWith({
      editUrl: "https://client.example.com/?rcf_edit_token=short-lived",
    });
    const { result } = renderHook(() => useEditSession(DOMAIN));

    let message: string | null = "unset";
    await act(async () => {
      message = await result.current.openEditSession(REQUEST);
    });

    expect(message).toBeNull();
    expect(popup.location.href).toBe(
      "https://client.example.com/?rcf_edit_token=short-lived",
    );
    expect(popup.close).not.toHaveBeenCalled();
  });

  it.each([
    "javascript:alert(1)",
    "https://attacker.example/?rcf_edit_token=stolen",
  ])("rejects an unsafe edit URL: %s", async (editUrl) => {
    respondWith({ editUrl });
    const { result } = renderHook(() => useEditSession(DOMAIN));

    let message: string | null = null;
    await act(async () => {
      message = await result.current.openEditSession(REQUEST);
    });

    expect(message).toMatch(/valid edit link/i);
    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.href).toBe("");
  });

  it("closes the tab and returns the server's message when the request is refused", async () => {
    respondWith(
      { error: "Failed to create edit session. Check your site permissions." },
      false,
    );
    const { result } = renderHook(() => useEditSession(DOMAIN));

    let message: string | null = null;
    await act(async () => {
      message = await result.current.openEditSession(REQUEST);
    });

    expect(message).toBe(
      "Failed to create edit session. Check your site permissions.",
    );
    expect(popup.close).toHaveBeenCalled();
  });

  it("sends nothing and says how to fix it when the pop-up is blocked", async () => {
    respondWith({ editUrl: "https://client.example.com/edit" });
    (window.open as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() => useEditSession(DOMAIN));

    let message: string | null = null;
    await act(async () => {
      message = await result.current.openEditSession(REQUEST);
    });

    expect(message).toBe("Allow pop-ups for ReCopyFast, then try again.");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.isOpening).toBe(false);
  });
});
