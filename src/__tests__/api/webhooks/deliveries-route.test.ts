/**
 * GET /api/webhooks/deliveries — recent delivery history for one webhook (AC 1).
 *
 * PLAN GAP, recorded here rather than worked around silently: the panel in
 * `docs/designs/s16-webhook-config.md` renders a delivery-history list and AC 1
 * requires it, but no route exposed `webhook_deliveries` — `getDeliveryLogs`
 * existed on the manager with zero callers, the same shape of dead code as
 * `triggerEvent`. This route is the smallest thing that gives that list a
 * source, with the same auth-then-permission shape as the rest of /api/webhooks.
 *
 * A delivery row can carry a customer's response body, so it is not readable by
 * anyone who merely knows a webhook id.
 */

import { NextRequest } from "next/server";
import { webhookManager } from "@/lib/webhooks/manager";

jest.mock("@/lib/webhooks/manager", () => ({
  ...jest.requireActual("@/lib/webhooks/manager"),
  webhookManager: { getDeliveryLogs: jest.fn() },
}));

const mockGetUser = jest.fn();
const tableResults: Record<string, { data?: unknown; error?: unknown }> = {};

function builder(table: string) {
  const result = tableResults[table] ?? { data: null, error: null };
  const chain: Record<string, unknown> = {
    single: jest.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  for (const method of ["select", "eq"]) {
    chain[method] = jest.fn(() => chain);
  }
  return chain;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: jest.fn((table: string) => builder(table)),
    }),
  ),
}));

import { GET } from "@/app/api/webhooks/deliveries/route";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const WEBHOOK_ID = "22222222-2222-4222-8222-222222222222";
const USER = { id: "user-1" };

const manager = webhookManager as jest.Mocked<typeof webhookManager>;

function deliveriesRequest(query = `webhookId=${WEBHOOK_ID}`) {
  return new NextRequest(
    `https://www.recopyfa.st/api/webhooks/deliveries?${query}`,
  );
}

describe("GET /api/webhooks/deliveries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
    tableResults.site_permissions = {
      data: { permission: "edit" },
      error: null,
    };
    tableResults.webhooks = {
      data: { site_id: SITE_ID, created_by: USER.id },
      error: null,
    };
    manager.getDeliveryLogs.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns recent deliveries for a permitted caller", async () => {
    manager.getDeliveryLogs.mockResolvedValue([
      {
        id: "d-1",
        webhook_id: WEBHOOK_ID,
        event_type: "content.updated",
        payload: {},
        attempt_number: 2,
        success: false,
        status: "retrying",
        next_retry_at: "2026-08-16T14:00:00.000Z",
        delivered_at: "2026-08-16T13:47:00.000Z",
      },
    ]);

    const response = await GET(deliveriesRequest());
    const body = (await response.json()) as {
      deliveries: Array<{ status: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.deliveries[0].status).toBe("retrying");
    expect(manager.getDeliveryLogs).toHaveBeenCalledWith(WEBHOOK_ID, 20);
  });

  it("refuses an unauthenticated caller", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(deliveriesRequest());

    expect(response.status).toBe(401);
    expect(manager.getDeliveryLogs).not.toHaveBeenCalled();
  });

  it("refuses a caller without permission on the webhook's site", async () => {
    tableResults.site_permissions = {
      data: { permission: "view" },
      error: null,
    };

    const response = await GET(deliveriesRequest());

    expect(response.status).toBe(403);
    expect(manager.getDeliveryLogs).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown webhook", async () => {
    tableResults.webhooks = { data: null, error: new Error("not found") };

    const response = await GET(deliveriesRequest());

    expect(response.status).toBe(404);
    expect(manager.getDeliveryLogs).not.toHaveBeenCalled();
  });

  it("refuses a request with no webhook id", async () => {
    const response = await GET(deliveriesRequest(""));

    expect(response.status).toBe(400);
    expect(manager.getDeliveryLogs).not.toHaveBeenCalled();
  });
});
