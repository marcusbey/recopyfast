/**
 * POST /api/webhooks/test — manual "send a test delivery" button (AC 7).
 *
 * The rate limit here is not boilerplate. This endpoint makes our
 * infrastructure send an HTTP request to an address the caller supplied, on
 * demand. Unmetered, that is a free SSRF probe once the URL check exists to
 * probe against, and a free way to point our egress at somebody else's server
 * as fast as a loop can press the button.
 */

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { webhookManager } from "@/lib/webhooks/manager";

jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/webhooks/manager", () => ({
  ...jest.requireActual("@/lib/webhooks/manager"),
  webhookManager: { testWebhook: jest.fn() },
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

import { POST } from "@/app/api/webhooks/test/route";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const WEBHOOK_ID = "22222222-2222-4222-8222-222222222222";
const USER = { id: "user-1" };

const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;
const manager = webhookManager as jest.Mocked<typeof webhookManager>;

function testRequest(
  body: Record<string, unknown> = { webhook_id: WEBHOOK_ID },
) {
  return new NextRequest("https://www.recopyfa.st/api/webhooks/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/test", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
    mockEnforceRateLimit.mockResolvedValue(null);
    tableResults.site_permissions = {
      data: { permission: "admin" },
      error: null,
    };
    tableResults.webhooks = {
      data: { site_id: SITE_ID, created_by: USER.id },
      error: null,
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends the test delivery for a permitted caller", async () => {
    manager.testWebhook.mockResolvedValue({
      success: true,
      statusCode: 200,
      responseTime: 340,
    });

    const response = await POST(testRequest());
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(manager.testWebhook).toHaveBeenCalledWith(WEBHOOK_ID);
  });

  it("is rate limited, fails closed, and sends nothing when throttled", async () => {
    mockEnforceRateLimit.mockResolvedValue(
      new Response(null, { status: 429 }) as never,
    );

    const response = await POST(testRequest());

    expect(response.status).toBe(429);
    expect(manager.testWebhook).not.toHaveBeenCalled();
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ onStoreFailure: "deny" }),
    );
  });

  it("refuses an unauthenticated caller", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(testRequest());

    expect(response.status).toBe(401);
    expect(manager.testWebhook).not.toHaveBeenCalled();
  });

  it("refuses a caller with only view permission", async () => {
    tableResults.site_permissions = {
      data: { permission: "view" },
      error: null,
    };

    const response = await POST(testRequest());

    expect(response.status).toBe(403);
    expect(manager.testWebhook).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown webhook", async () => {
    tableResults.webhooks = { data: null, error: new Error("not found") };

    const response = await POST(testRequest());

    expect(response.status).toBe(404);
    expect(manager.testWebhook).not.toHaveBeenCalled();
  });

  it("refuses a body without a webhook id", async () => {
    const response = await POST(testRequest({}));

    expect(response.status).toBe(400);
    expect(manager.testWebhook).not.toHaveBeenCalled();
  });
});
