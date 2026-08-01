import { WebhookManager, WEBHOOK_EVENTS } from "@/lib/webhooks/manager";
import { createServerClient } from "@supabase/ssr";
import crypto from "crypto";

/**
 * WebhookManager calls the global `fetch` (Node 20+), not `node-fetch` — the
 * previous version of this file mocked `node-fetch`, so the mock never
 * intercepted anything and the package had no type declarations either.
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@supabase/ssr");

type QueryResult = { data?: unknown; error: unknown };

/**
 * Supabase query-builder stub. Every chain link returns the builder, which is
 * thenable and also exposes `.single()`, so both `await from().delete().eq()`
 * and `await from().select().eq().single()` resolve.
 *
 * `resultFor` maps a table name to the result its next query should produce.
 */
const calls = {
  insert: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  select: jest.fn(),
  eq: jest.fn(),
  contains: jest.fn(),
  order: jest.fn(),
  from: jest.fn(),
};

let resultsByTable: Record<string, QueryResult> = {};

const makeBuilder = (result: QueryResult) => {
  const builder: Record<string, unknown> = {
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
    single: jest.fn(() => Promise.resolve(result)),
  };
  for (const method of [
    "insert",
    "update",
    "delete",
    "select",
    "eq",
    "contains",
    "order",
  ] as const) {
    builder[method] = jest.fn((...args: unknown[]) => {
      calls[method](...args);
      return builder;
    });
  }
  return builder;
};

const mockSupabase = {
  from: jest.fn((table: string) => {
    calls.from(table);
    return makeBuilder(resultsByTable[table] ?? { data: null, error: null });
  }),
};

(createServerClient as jest.Mock).mockReturnValue(mockSupabase);

const okResponse = (status = 200, body = "OK") => ({
  ok: status >= 200 && status < 300,
  status,
  text: jest.fn().mockResolvedValue(body),
});

describe("WebhookManager", () => {
  let webhookManager: WebhookManager;

  beforeEach(() => {
    jest.clearAllMocks();
    resultsByTable = {};
    webhookManager = new WebhookManager();
  });

  describe("createWebhook", () => {
    it("should create a new webhook", async () => {
      const mockWebhook = {
        id: "webhook-123",
        site_id: "site-123",
        url: "https://example.com/webhook",
        events: ["content.updated"],
        secret: "secret-key",
      };
      resultsByTable.webhooks = { data: mockWebhook, error: null };

      const result = await webhookManager.createWebhook({
        siteId: "site-123",
        url: "https://example.com/webhook",
        events: ["content.updated"],
        createdBy: "user-123",
      });

      expect(calls.from).toHaveBeenCalledWith("webhooks");
      expect(calls.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          site_id: "site-123",
          url: "https://example.com/webhook",
          events: ["content.updated"],
          created_by: "user-123",
          is_active: true,
        }),
      );
      expect(result).toEqual(mockWebhook);
    });

    it("should generate a secret when the caller does not supply one", async () => {
      resultsByTable.webhooks = { data: { id: "webhook-123" }, error: null };

      await webhookManager.createWebhook({
        siteId: "site-123",
        url: "https://example.com/webhook",
        events: ["content.updated"],
        createdBy: "user-123",
      });

      const inserted = calls.insert.mock.calls[0][0] as { secret: string };
      expect(inserted.secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should throw error on database failure", async () => {
      resultsByTable.webhooks = {
        data: null,
        error: new Error("Database error"),
      };

      await expect(
        webhookManager.createWebhook({
          siteId: "site-123",
          url: "https://example.com/webhook",
          events: ["content.updated"],
          createdBy: "user-123",
        }),
      ).rejects.toThrow("Database error");
    });
  });

  describe("updateWebhook", () => {
    it("should update a webhook", async () => {
      const mockUpdatedWebhook = {
        id: "webhook-123",
        url: "https://example.com/new-webhook",
      };
      resultsByTable.webhooks = { data: mockUpdatedWebhook, error: null };

      const result = await webhookManager.updateWebhook("webhook-123", {
        url: "https://example.com/new-webhook",
      });

      expect(calls.from).toHaveBeenCalledWith("webhooks");
      expect(calls.update).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://example.com/new-webhook" }),
      );
      expect(result).toEqual(mockUpdatedWebhook);
    });
  });

  describe("deleteWebhook", () => {
    it("should delete a webhook", async () => {
      resultsByTable.webhooks = { error: null };

      await webhookManager.deleteWebhook("webhook-123");

      expect(calls.from).toHaveBeenCalledWith("webhooks");
      expect(calls.delete).toHaveBeenCalled();
      expect(calls.eq).toHaveBeenCalledWith("id", "webhook-123");
    });

    it("should throw when the delete fails", async () => {
      resultsByTable.webhooks = { error: new Error("Database error") };

      await expect(webhookManager.deleteWebhook("webhook-123")).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("getWebhooks", () => {
    it("should return active webhooks for a site", async () => {
      const mockWebhooks = [
        { id: "webhook-1", url: "https://example1.com/webhook" },
        { id: "webhook-2", url: "https://example2.com/webhook" },
      ];
      resultsByTable.webhooks = { data: mockWebhooks, error: null };

      const result = await webhookManager.getWebhooks("site-123");

      expect(calls.from).toHaveBeenCalledWith("webhooks");
      expect(calls.select).toHaveBeenCalledWith("*");
      expect(calls.eq).toHaveBeenCalledWith("site_id", "site-123");
      expect(calls.eq).toHaveBeenCalledWith("is_active", true);
      expect(result).toEqual(mockWebhooks);
    });

    it("should throw on a database error", async () => {
      resultsByTable.webhooks = {
        data: null,
        error: new Error("Database error"),
      };

      await expect(webhookManager.getWebhooks("site-123")).rejects.toThrow(
        "Database error",
      );
    });
  });

  describe("triggerEvent", () => {
    const activeWebhook = {
      id: "webhook-1",
      site_id: "site-123",
      url: "https://example.com/webhook",
      secret: "secret-key",
      failure_count: 0,
      max_failures: 5,
    };

    it("should deliver to webhooks subscribed to the event", async () => {
      resultsByTable.webhooks = { data: [activeWebhook], error: null };
      resultsByTable.webhook_deliveries = { error: null };
      mockFetch.mockResolvedValue(okResponse());

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: { elementId: "elem-123", content: "New content" },
      });

      expect(calls.from).toHaveBeenCalledWith("webhooks");
      expect(calls.contains).toHaveBeenCalledWith("events", [
        WEBHOOK_EVENTS.CONTENT_UPDATED,
      ]);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/webhook",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-ReCopyFast-Event": WEBHOOK_EVENTS.CONTENT_UPDATED,
          }),
        }),
      );
    });

    it("should sign the delivered payload with the webhook secret", async () => {
      resultsByTable.webhooks = { data: [activeWebhook], error: null };
      resultsByTable.webhook_deliveries = { error: null };
      mockFetch.mockResolvedValue(okResponse());

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: { elementId: "elem-123" },
      });

      const [, init] = mockFetch.mock.calls[0];
      const expectedSignature = crypto
        .createHmac("sha256", "secret-key")
        .update(init.body)
        .digest("hex");
      expect(init.headers["X-ReCopyFast-Signature"]).toBe(expectedSignature);
    });

    it("should reset the failure count after a successful delivery", async () => {
      resultsByTable.webhooks = { data: [activeWebhook], error: null };
      resultsByTable.webhook_deliveries = { error: null };
      mockFetch.mockResolvedValue(okResponse());

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: {},
      });

      expect(calls.update).toHaveBeenCalledWith(
        expect.objectContaining({ failure_count: 0 }),
      );
    });

    it("should increment the failure count on a non-2xx response", async () => {
      resultsByTable.webhooks = { data: [activeWebhook], error: null };
      resultsByTable.webhook_deliveries = { error: null };
      mockFetch.mockResolvedValue(okResponse(500, "Internal Server Error"));

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: { elementId: "elem-123" },
      });

      expect(calls.update).toHaveBeenCalledWith(
        expect.objectContaining({ failure_count: 1 }),
      );
    });

    it("should disable the webhook once max failures is reached", async () => {
      resultsByTable.webhooks = {
        // One more failure hits max_failures.
        data: [{ ...activeWebhook, failure_count: 4 }],
        error: null,
      };
      resultsByTable.webhook_deliveries = { error: null };
      mockFetch.mockRejectedValue(new Error("Network error"));

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: { elementId: "elem-123" },
      });

      expect(calls.update).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: false, failure_count: 5 }),
      );
    });

    it("should make no requests when no webhook subscribes to the event", async () => {
      resultsByTable.webhooks = { data: [], error: null };

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: {},
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("testWebhook", () => {
    it("should test webhook endpoint successfully", async () => {
      resultsByTable.webhooks = {
        data: {
          id: "webhook-123",
          url: "https://example.com/webhook",
          site_id: "site-123",
          secret: "secret-key",
        },
        error: null,
      };
      resultsByTable.webhook_deliveries = { error: null };
      mockFetch.mockResolvedValue(okResponse());

      const result = await webhookManager.testWebhook("webhook-123");

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/webhook",
        expect.objectContaining({
          headers: expect.objectContaining({ "X-ReCopyFast-Test": "true" }),
        }),
      );
    });

    it("should return error for non-existent webhook", async () => {
      resultsByTable.webhooks = { data: null, error: new Error("Not found") };

      const result = await webhookManager.testWebhook("non-existent");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Webhook not found");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should handle network errors during test", async () => {
      resultsByTable.webhooks = {
        data: {
          id: "webhook-123",
          url: "https://example.com/webhook",
          site_id: "site-123",
          secret: "secret-key",
        },
        error: null,
      };
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await webhookManager.testWebhook("webhook-123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });

  describe("verifySignature", () => {
    const payload = "test payload";
    const secret = "test-secret";
    const validSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    it("should verify correct signature", () => {
      expect(
        webhookManager.verifySignature(payload, validSignature, secret),
      ).toBe(true);
    });

    it("should reject a same-length signature that does not match", () => {
      // Flip the first hex digit so the length still matches.
      const wrongSignature =
        (validSignature[0] === "a" ? "b" : "a") + validSignature.slice(1);

      expect(
        webhookManager.verifySignature(payload, wrongSignature, secret),
      ).toBe(false);
    });

    /**
     * KNOWN PRODUCTION DEFECT — src/lib/webhooks/manager.ts:375.
     *
     * verifySignature feeds attacker-controlled input straight into
     * crypto.timingSafeEqual, which throws RangeError when the two buffers
     * differ in length. A malformed or truncated `X-ReCopyFast-Signature`
     * therefore raises instead of returning false, so an inbound verification
     * endpoint would answer 500 rather than rejecting the request. The fix is a
     * length check (or hashing both sides to a fixed width) before comparing.
     *
     * `it.failing` keeps the correct expectation: it passes while the defect
     * exists and starts failing once manager.ts is fixed.
     */
    it.failing("should reject a signature of the wrong length", () => {
      expect(
        webhookManager.verifySignature(payload, "invalid-signature", secret),
      ).toBe(false);
    });

    it("currently throws on a wrong-length signature (pins the defect above)", () => {
      // Matched by message: Node's crypto throws a RangeError from a different
      // realm than the jsdom global, so `toThrow(RangeError)` does not match.
      expect(() =>
        webhookManager.verifySignature(payload, "abcd", secret),
      ).toThrow("Input buffers must have the same byte length");
    });
  });
});
