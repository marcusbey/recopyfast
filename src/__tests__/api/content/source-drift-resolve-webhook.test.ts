/**
 * @jest-environment node
 *
 * s119 review m3 — "Use new source" changes published copy, so it records the
 * same `content.updated` webhook marker `POST /api/staging/publish` records,
 * through the same `webhookManager.recordQualifyingEvent`, deferred with
 * `after()` exactly as publish does. Integrators that rebuild a static site or
 * a snapshot cache on that webhook would otherwise miss the change. "Keep
 * override" changes no copy and records nothing; neither does a refusal.
 */

import { after, NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { checkOwnerCanEdit } from "@/lib/billing/owner-can-edit";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { webhookManager, WEBHOOK_EVENTS } from "@/lib/webhooks/manager";

jest.mock("@/lib/api/rate-limit", () => ({ enforceRateLimit: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/billing/owner-can-edit", () => {
  const actual = jest.requireActual("@/lib/billing/owner-can-edit");
  return { ...actual, checkOwnerCanEdit: jest.fn() };
});
jest.mock("@/lib/webhooks/manager", () => ({
  ...jest.requireActual("@/lib/webhooks/manager"),
  webhookManager: { recordQualifyingEvent: jest.fn() },
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({
        data: { permission: "admin" },
        error: null,
      }),
    };
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: USER_ID, email: "dev@example.com" } },
        }),
      },
      from: () => builder,
    };
  }),
}));

import { POST } from "@/app/api/content/source-drift/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const mockAfter = after as jest.Mock;
const mockRecord = webhookManager.recordQualifyingEvent as jest.Mock;
const mockRpc = jest.fn();
const mockRowRead = jest.fn();
const rowFilters: Array<[string, unknown]> = [];

function post(resolution: "keep" | "drop"): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/content/source-drift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId: SITE_ID,
        contentElementId: ROW_ID,
        resolution,
        expectedObserved: "5 to 9",
      }),
    }),
  ) as Promise<Response>;
}

/** Runs whatever the route handed to `after()`. */
async function runDeferred() {
  for (const [callback] of mockAfter.mock.calls) {
    await callback();
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  rowFilters.length = 0;
  (enforceRateLimit as jest.Mock).mockResolvedValue(null);
  (checkOwnerCanEdit as jest.Mock).mockResolvedValue({
    ok: true,
    ownerId: USER_ID,
  });
  mockRpc.mockResolvedValue({ data: "resolved", error: null });
  mockRowRead.mockResolvedValue({
    data: { element_id: "pricing-range" },
    error: null,
  });
  mockRecord.mockResolvedValue(undefined);
  const rowBuilder = {
    select: () => rowBuilder,
    eq: (column: string, value: unknown) => {
      rowFilters.push([column, value]);
      return rowBuilder;
    },
    maybeSingle: () => mockRowRead(),
  };
  (createServiceRoleClient as jest.Mock).mockReturnValue({
    rpc: mockRpc,
    from: () => rowBuilder,
  });
});

describe("POST /api/content/source-drift — content.updated marker", () => {
  it("Use new source records content.updated with the element's new published copy, after the response", async () => {
    const response = await post("drop");

    expect(response.status).toBe(200);
    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockAfter).toHaveBeenCalledTimes(1);

    await runDeferred();

    expect(mockRecord).toHaveBeenCalledWith({
      siteId: SITE_ID,
      eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
      payload: {
        elements: [
          { element_id: "pricing-range", content: "5 to 9", attributes: {} },
        ],
      },
    });
    expect(rowFilters).toEqual(
      expect.arrayContaining([
        ["id", ROW_ID],
        ["site_id", SITE_ID],
      ]),
    );
  });

  it("Keep override changes no copy and records nothing", async () => {
    await post("keep");
    await runDeferred();

    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it.each(["conflict", "pending", "missing"])(
    "a %s answer records nothing",
    async (status) => {
      mockRpc.mockResolvedValueOnce({ data: status, error: null });

      await post("drop");
      await runDeferred();

      expect(mockRecord).not.toHaveBeenCalled();
    },
  );

  it("a failed marker is logged and never touches the answer already sent", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockRecord.mockRejectedValueOnce(new Error("webhooks table down"));

    const response = await post("drop");
    await expect(runDeferred()).resolves.toBeUndefined();

    expect(response.status).toBe(200);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("content.updated"),
      expect.anything(),
    );
    consoleError.mockRestore();
  });

  it("records nothing, and logs, when the element id cannot be read", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockRowRead.mockResolvedValueOnce({
      data: null,
      error: { message: "gone" },
    });

    await post("drop");
    await runDeferred();

    expect(mockRecord).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
