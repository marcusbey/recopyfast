/**
 * /api/webhooks — configuration CRUD.
 *
 * NOT the Stripe route. `src/app/api/webhooks/stripe/route.ts` is INBOUND
 * Stripe event handling and shares nothing with this file but a parent
 * directory name; a grep for "webhooks" that forgets the path pulls in both.
 *
 * Three properties here have already been wrong in production or were about to
 * be, and each has its own case below:
 *
 *   1. The secret was returned on every GET. "Shown once at creation" is only
 *      true if the list path cannot serve it.
 *   2. PUT spread `{ webhook_id, ...updates }` straight into the update, so a
 *      caller could set `secret` or reset `failure_count` — i.e. re-arm a
 *      webhook the platform had auto-disabled, or choose the signing key.
 *   3. Neither write was rate limited, and neither validated the URL beyond
 *      `new URL()`.
 */

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { webhookManager } from "@/lib/webhooks/manager";

jest.mock("dns", () => ({ promises: { lookup: jest.fn() } }));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/webhooks/manager", () => ({
  ...jest.requireActual("@/lib/webhooks/manager"),
  webhookManager: {
    createWebhook: jest.fn(),
    updateWebhook: jest.fn(),
    deleteWebhook: jest.fn(),
    getWebhooks: jest.fn(),
  },
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
  for (const method of [
    "select",
    "eq",
    "order",
    "insert",
    "update",
    "delete",
  ]) {
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { promises: dns } = require("dns") as {
  promises: { lookup: jest.Mock };
};

import { GET, POST, PUT, DELETE } from "@/app/api/webhooks/route";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const WEBHOOK_ID = "22222222-2222-4222-8222-222222222222";
const USER = { id: "user-1", email: "owner@example.com" };

const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;
const manager = webhookManager as jest.Mocked<typeof webhookManager>;

function jsonRequest(method: string, body: Record<string, unknown>) {
  return new NextRequest("https://www.recopyfa.st/api/webhooks", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(query: string) {
  return new NextRequest(`https://www.recopyfa.st/api/webhooks?${query}`);
}

function grantPermission(level: string | null) {
  tableResults.site_permissions = level
    ? { data: { permission: level }, error: null }
    : { data: null, error: new Error("no row") };
}

describe("/api/webhooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
    mockEnforceRateLimit.mockResolvedValue(null);
    dns.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    grantPermission("admin");
    tableResults.webhooks = {
      data: { site_id: SITE_ID, created_by: USER.id },
      error: null,
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET", () => {
    it("refuses an unauthenticated caller", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const response = await GET(getRequest(`siteId=${SITE_ID}`));

      expect(response.status).toBe(401);
      expect(manager.getWebhooks).not.toHaveBeenCalled();
    });

    it("refuses a caller with only view permission on the site", async () => {
      grantPermission("view");

      const response = await GET(getRequest(`siteId=${SITE_ID}`));

      expect(response.status).toBe(403);
      expect(manager.getWebhooks).not.toHaveBeenCalled();
    });

    it("returns the site's webhooks and no secret", async () => {
      manager.getWebhooks.mockResolvedValue([
        {
          id: WEBHOOK_ID,
          site_id: SITE_ID,
          url: "https://build.example.com/hook",
          events: ["content.updated"],
          secret_prefix: "a1b2c3d4",
          is_active: true,
          failure_count: 0,
          max_failures: 5,
          coalesce_window_seconds: 30,
          created_at: "2026-08-16T00:00:00.000Z",
          updated_at: "2026-08-16T00:00:00.000Z",
        },
      ]);

      const response = await GET(getRequest(`siteId=${SITE_ID}`));
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(200);
      expect(body).toContain("a1b2c3d4");
      expect(body).not.toContain('"secret"');
    });
  });

  describe("POST", () => {
    const validBody = {
      site_id: SITE_ID,
      url: "https://build.example.com/hook",
      events: ["content.updated"],
    };

    it("is rate limited before it authenticates anything", async () => {
      mockEnforceRateLimit.mockResolvedValue(
        new Response(null, { status: 429 }) as never,
      );

      const response = await POST(jsonRequest("POST", validBody));

      expect(response.status).toBe(429);
      expect(manager.createWebhook).not.toHaveBeenCalled();
      expect(mockEnforceRateLimit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ onStoreFailure: "deny" }),
      );
    });

    it("refuses a link-local URL and names the address class", async () => {
      const response = await POST(
        jsonRequest("POST", {
          ...validBody,
          url: "http://169.254.169.254/rebuild",
        }),
      );
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toMatch(/link-local/i);
      expect(manager.createWebhook).not.toHaveBeenCalled();
    });

    it("refuses a hostname that resolves to a private address", async () => {
      dns.lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

      const response = await POST(jsonRequest("POST", validBody));
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toMatch(/private/i);
      expect(manager.createWebhook).not.toHaveBeenCalled();
    });

    it("returns the plaintext secret exactly once, alongside a webhook that omits it", async () => {
      manager.createWebhook.mockResolvedValue({
        id: WEBHOOK_ID,
        site_id: SITE_ID,
        url: "https://build.example.com/hook",
        events: ["content.updated"],
        secret: "f".repeat(64),
        secret_prefix: "ffffffff",
        is_active: true,
        failure_count: 0,
        max_failures: 5,
        coalesce_window_seconds: 30,
        created_at: "2026-08-16T00:00:00.000Z",
        updated_at: "2026-08-16T00:00:00.000Z",
      });

      const response = await POST(jsonRequest("POST", validBody));
      const body = (await response.json()) as {
        webhook: Record<string, unknown>;
        secret: string;
        warning: string;
      };

      expect(response.status).toBe(201);
      expect(body.secret).toBe("f".repeat(64));
      expect(body.webhook).not.toHaveProperty("secret");
      expect(body.warning).toMatch(/not be shown again/i);
    });

    it("ignores a caller-supplied secret", async () => {
      manager.createWebhook.mockResolvedValue({
        id: WEBHOOK_ID,
      } as never);

      await POST(
        jsonRequest("POST", { ...validBody, secret: "attacker-chosen" }),
      );

      expect(manager.createWebhook).toHaveBeenCalledWith(
        expect.not.objectContaining({ secret: expect.anything() }),
      );
    });

    it("refuses an unknown event type", async () => {
      const response = await POST(
        jsonRequest("POST", { ...validBody, events: ["content.exfiltrated"] }),
      );

      expect(response.status).toBe(400);
      expect(manager.createWebhook).not.toHaveBeenCalled();
    });
  });

  describe("PUT", () => {
    it("never lets the caller set the secret or reset the failure count", async () => {
      manager.updateWebhook.mockResolvedValue({ id: WEBHOOK_ID } as never);

      const response = await PUT(
        jsonRequest("PUT", {
          webhook_id: WEBHOOK_ID,
          url: "https://build.example.com/other",
          secret: "attacker-chosen",
          failure_count: 0,
          is_active: true,
        }),
      );

      expect(response.status).toBe(200);
      const [, updates] = manager.updateWebhook.mock.calls[0];
      expect(updates).not.toHaveProperty("secret");
      expect(updates).not.toHaveProperty("failure_count");
      expect(updates).toEqual(
        expect.objectContaining({
          url: "https://build.example.com/other",
          is_active: true,
        }),
      );
    });

    it("refuses a loopback URL", async () => {
      const response = await PUT(
        jsonRequest("PUT", {
          webhook_id: WEBHOOK_ID,
          url: "http://127.0.0.1/rebuild",
        }),
      );
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toMatch(/loopback/i);
      expect(manager.updateWebhook).not.toHaveBeenCalled();
    });

    it("accepts a coalescing window and refuses an out-of-range one", async () => {
      manager.updateWebhook.mockResolvedValue({ id: WEBHOOK_ID } as never);

      const ok = await PUT(
        jsonRequest("PUT", {
          webhook_id: WEBHOOK_ID,
          coalesce_window_seconds: 300,
        }),
      );
      expect(ok.status).toBe(200);
      expect(manager.updateWebhook).toHaveBeenCalledWith(
        WEBHOOK_ID,
        expect.objectContaining({ coalesce_window_seconds: 300 }),
      );

      const refused = await PUT(
        jsonRequest("PUT", {
          webhook_id: WEBHOOK_ID,
          coalesce_window_seconds: 1,
        }),
      );
      expect(refused.status).toBe(400);
    });

    it("refuses a caller without edit permission on the webhook's site", async () => {
      grantPermission("view");

      const response = await PUT(
        jsonRequest("PUT", { webhook_id: WEBHOOK_ID, is_active: false }),
      );

      expect(response.status).toBe(403);
      expect(manager.updateWebhook).not.toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    it("deletes with permission and answers 204", async () => {
      const response = await DELETE(getRequest(`webhookId=${WEBHOOK_ID}`));

      expect(response.status).toBe(204);
      expect(manager.deleteWebhook).toHaveBeenCalledWith(WEBHOOK_ID);
    });

    it("refuses a caller without permission", async () => {
      grantPermission(null);

      const response = await DELETE(getRequest(`webhookId=${WEBHOOK_ID}`));

      expect(response.status).toBe(403);
      expect(manager.deleteWebhook).not.toHaveBeenCalled();
    });

    it("answers 404 for a webhook that does not exist", async () => {
      tableResults.webhooks = { data: null, error: new Error("not found") };

      const response = await DELETE(getRequest(`webhookId=${WEBHOOK_ID}`));

      expect(response.status).toBe(404);
      expect(manager.deleteWebhook).not.toHaveBeenCalled();
    });
  });
});
