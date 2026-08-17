import { promises as dns } from "dns";
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

/**
 * Every outbound path now re-checks the URL against SSRF immediately before it
 * fetches (AC 5, DNS rebinding). Without this mock the suite would perform a
 * real DNS lookup of example.com on every delivery assertion — slow, and green
 * or red depending on the resolver the machine happens to have.
 */
jest.mock("dns", () => ({ promises: { lookup: jest.fn() } }));

const mockLookup = dns.lookup as unknown as jest.Mock;

/** A publicly routable address, so the SSRF guard lets the delivery through. */
const PUBLIC_ADDRESS = [{ address: "93.184.216.34", family: 4 }];

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
  lte: jest.fn(),
  limit: jest.fn(),
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
    "lte",
    "limit",
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
    mockLookup.mockResolvedValue(PUBLIC_ADDRESS);
    webhookManager = new WebhookManager();
  });

  describe("createWebhook", () => {
    it("should create a new webhook", async () => {
      const mockWebhook = {
        id: "webhook-123",
        site_id: "site-123",
        url: "https://example.com/webhook",
        events: ["content.updated"],
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
      // BEHAVIOUR CHANGE: the row used to come back verbatim, secret included,
      // because whatever the caller passed was what got stored. The secret is
      // now generated here and is the one field the return value overrides.
      expect(result).toEqual({
        ...mockWebhook,
        secret: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    });

    /**
     * The secret is generated server-side, always. `createWebhook` used to take
     * an optional caller-supplied `secret` and fall back to generating one only
     * when it was absent, so a caller could choose — or reuse — the value that
     * signs every delivery. The parameter is gone; there is no longer a way to
     * express it.
     */
    it("always generates the secret server-side", async () => {
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

    it("stores a secret_prefix matching the first 8 characters of the secret", async () => {
      resultsByTable.webhooks = { data: { id: "webhook-123" }, error: null };

      await webhookManager.createWebhook({
        siteId: "site-123",
        url: "https://example.com/webhook",
        events: ["content.updated"],
        createdBy: "user-123",
      });

      const inserted = calls.insert.mock.calls[0][0] as {
        secret: string;
        secret_prefix: string;
      };
      expect(inserted.secret_prefix).toBe(inserted.secret.slice(0, 8));
    });

    /**
     * The one and only moment the plaintext secret is available to a caller.
     * The row the database sends back is deliberately not trusted to carry it —
     * the return value does, so the show-once route cannot be broken by a
     * change to what the insert selects.
     */
    it("returns the plaintext secret even when the inserted row does not carry it", async () => {
      resultsByTable.webhooks = {
        data: { id: "webhook-123", site_id: "site-123" },
        error: null,
      };

      const result = await webhookManager.createWebhook({
        siteId: "site-123",
        url: "https://example.com/webhook",
        events: ["content.updated"],
        createdBy: "user-123",
      });

      expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it("defaults the coalescing window and accepts an explicit one", async () => {
      resultsByTable.webhooks = { data: { id: "webhook-123" }, error: null };

      await webhookManager.createWebhook({
        siteId: "site-123",
        url: "https://example.com/webhook",
        events: ["content.updated"],
        createdBy: "user-123",
      });
      expect(calls.insert).toHaveBeenLastCalledWith(
        expect.objectContaining({ coalesce_window_seconds: 30 }),
      );

      await webhookManager.createWebhook({
        siteId: "site-123",
        url: "https://example.com/webhook",
        events: ["content.updated"],
        createdBy: "user-123",
        coalesceWindowSeconds: 300,
      });
      expect(calls.insert).toHaveBeenLastCalledWith(
        expect.objectContaining({ coalesce_window_seconds: 300 }),
      );
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
      expect(calls.eq).toHaveBeenCalledWith("site_id", "site-123");
      expect(calls.eq).toHaveBeenCalledWith("is_active", true);
      expect(result).toEqual(mockWebhooks);
    });

    /**
     * BEHAVIOUR CHANGE, and the reason this assertion replaced
     * `expect(calls.select).toHaveBeenCalledWith("*")`.
     *
     * `select("*")` returned the plaintext `secret` column on every list call,
     * so a secret described as "shown once at creation" was in fact re-served
     * on every page load of the settings panel. The list now names its columns,
     * and `secret` is not one of them.
     */
    it("asks for named columns and never for the secret", async () => {
      resultsByTable.webhooks = { data: [], error: null };

      await webhookManager.getWebhooks("site-123");

      const selected = calls.select.mock.calls[0][0] as string;
      expect(selected).not.toBe("*");
      expect(selected).toContain("secret_prefix");
      expect(selected.replace(/secret_prefix/g, "")).not.toContain("secret");
      expect(selected).toContain("coalesce_window_seconds");
    });

    it("strips a secret out of any row that still carries one", async () => {
      // Defence in depth: even against a database or a future migration that
      // hands back more than was asked for, the plaintext secret leaves this
      // class through exactly one door — createWebhook's return value.
      resultsByTable.webhooks = {
        data: [{ id: "webhook-1", secret: "leaked-plaintext" }],
        error: null,
      };

      const result = await webhookManager.getWebhooks("site-123");

      expect(result[0]).not.toHaveProperty("secret");
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

  /**
   * Coalescing (AC 4) and retry (AC 3) are the same shape: "do this later, once
   * a condition is true", where "later" outlives the request that created it.
   * Neither can be a timer — see ADR 010. What the publish path writes is a
   * marker; what fires it is a cron sweep.
   */
  describe("recordQualifyingEvent", () => {
    const subscribed = {
      id: "webhook-1",
      site_id: "site-123",
      coalesce_window_seconds: 30,
      pending_dispatch_at: null,
    };

    it("opens a window on the first qualifying event", async () => {
      resultsByTable.webhooks = { data: [subscribed], error: null };
      const before = Date.now();

      await webhookManager.recordQualifyingEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: { elements: [{ element_id: "hero" }] },
      });

      expect(calls.contains).toHaveBeenCalledWith("events", [
        WEBHOOK_EVENTS.CONTENT_UPDATED,
      ]);
      const update = calls.update.mock.calls[0][0] as {
        pending_event_type: string;
        pending_payload: Record<string, unknown>;
        pending_dispatch_at: string;
      };
      expect(update.pending_event_type).toBe(WEBHOOK_EVENTS.CONTENT_UPDATED);
      expect(update.pending_payload).toEqual({
        elements: [{ element_id: "hero" }],
      });
      const due = new Date(update.pending_dispatch_at).getTime();
      expect(due).toBeGreaterThanOrEqual(before + 30_000);
      expect(due).toBeLessThanOrEqual(Date.now() + 30_000);
    });

    /**
     * Throttle, not debounce. A window already open is NOT pushed forward by a
     * later edit — a debounce that resets on every keystroke has no upper bound
     * on latency under continuous editing, which for a "rebuild my site"
     * trigger is a worse failure than delivering early with a merged payload.
     */
    it("replaces the payload without moving a window that is already open", async () => {
      const openWindow = new Date(Date.now() + 20_000).toISOString();
      resultsByTable.webhooks = {
        data: [{ ...subscribed, pending_dispatch_at: openWindow }],
        error: null,
      };

      await webhookManager.recordQualifyingEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: { elements: [{ element_id: "footer" }] },
      });

      const update = calls.update.mock.calls[0][0] as Record<string, unknown>;
      expect(update.pending_payload).toEqual({
        elements: [{ element_id: "footer" }],
      });
      expect(update).not.toHaveProperty("pending_dispatch_at");
    });

    it("writes nothing when no webhook subscribes to the event", async () => {
      resultsByTable.webhooks = { data: [], error: null };

      await webhookManager.recordQualifyingEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: {},
      });

      expect(calls.update).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("never throws — it runs inside after(), where there is no response left to shape", async () => {
      resultsByTable.webhooks = { data: null, error: new Error("db down") };

      await expect(
        webhookManager.recordQualifyingEvent({
          siteId: "site-123",
          eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
          payload: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("sweepDueDispatches", () => {
    const dueWebhook = {
      id: "webhook-1",
      site_id: "site-123",
      url: "https://example.com/webhook",
      secret: "secret-key",
      failure_count: 0,
      max_failures: 5,
      pending_event_type: WEBHOOK_EVENTS.CONTENT_UPDATED,
      pending_payload: { elements: [{ element_id: "hero" }] },
      pending_dispatch_at: new Date(Date.now() - 1000).toISOString(),
    };

    it("selects only windows that have already elapsed", async () => {
      resultsByTable.webhooks = { data: [], error: null };

      const result = await webhookManager.sweepDueDispatches();

      expect(calls.lte).toHaveBeenCalledWith(
        "pending_dispatch_at",
        expect.any(String),
      );
      expect(result).toEqual({ dispatched: 0 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("delivers the coalesced payload and clears the window", async () => {
      resultsByTable.webhooks = { data: [dueWebhook], error: null };
      resultsByTable.webhook_deliveries = { data: { id: "d-1" }, error: null };
      mockFetch.mockResolvedValue(okResponse());

      const result = await webhookManager.sweepDueDispatches();

      expect(result).toEqual({ dispatched: 1 });
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.com/webhook");
      expect(JSON.parse(init.body).data).toEqual({
        elements: [{ element_id: "hero" }],
      });
      expect(calls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          pending_event_type: null,
          pending_payload: null,
          pending_dispatch_at: null,
        }),
      );
    });

    it("clears the window even when the delivery fails, so retry is owned by the delivery row", async () => {
      resultsByTable.webhooks = { data: [dueWebhook], error: null };
      resultsByTable.webhook_deliveries = { data: { id: "d-1" }, error: null };
      mockFetch.mockRejectedValue(new Error("Network error"));

      await webhookManager.sweepDueDispatches();

      expect(calls.update).toHaveBeenCalledWith(
        expect.objectContaining({ pending_dispatch_at: null }),
      );
    });
  });

  /**
   * RETRY — REWRITTEN, AND WHY.
   *
   * The previous version of this section asserted against
   * `setTimeout(() => this.retryWebhook(...), delay)` with delays up to five
   * minutes. On Vercel that timer never fires: the invocation ends at (or
   * shortly after) its response, so in production every retry was silently
   * dropped and nothing recorded that it had been. That is a correctness bug in
   * inherited code, not a hardening gap, and the mechanism is replaced rather
   * than retimed — `status` + `next_retry_at` on the delivery row, swept by
   * /api/cron/webhook-dispatch (ADR 010).
   *
   * The backoff FORMULA is unchanged (2^attempt seconds, capped at five
   * minutes). Only its trigger changed.
   */
  describe("retry state on the delivery row", () => {
    const failing = {
      id: "webhook-1",
      site_id: "site-123",
      url: "https://example.com/webhook",
      secret: "secret-key",
      failure_count: 0,
      max_failures: 5,
    };

    it("records a failed first attempt as retrying, due one backoff from now", async () => {
      resultsByTable.webhooks = { data: [failing], error: null };
      resultsByTable.webhook_deliveries = { data: { id: "d-1" }, error: null };
      mockFetch.mockResolvedValue(okResponse(500, "boom"));
      const before = Date.now();

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: {},
      });

      const inserted = calls.insert.mock.calls[0][0] as {
        status: string;
        attempt_number: number;
        next_retry_at: string;
      };
      expect(inserted.status).toBe("retrying");
      expect(inserted.attempt_number).toBe(1);
      // 2^1 * 1000ms — the formula the old setTimeout used, now persisted.
      const due = new Date(inserted.next_retry_at).getTime();
      expect(due).toBeGreaterThanOrEqual(before + 2000);
      expect(due).toBeLessThanOrEqual(Date.now() + 2000);
    });

    it("records a successful delivery as delivered with nothing due", async () => {
      resultsByTable.webhooks = { data: [failing], error: null };
      resultsByTable.webhook_deliveries = { data: { id: "d-1" }, error: null };
      mockFetch.mockResolvedValue(okResponse());

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: {},
      });

      expect(calls.insert).toHaveBeenCalledWith(
        expect.objectContaining({ status: "delivered", next_retry_at: null }),
      );
    });

    it("schedules no in-process timer for the retry", async () => {
      const setTimeoutSpy = jest.spyOn(global, "setTimeout");
      resultsByTable.webhooks = { data: [failing], error: null };
      resultsByTable.webhook_deliveries = { data: { id: "d-1" }, error: null };
      mockFetch.mockResolvedValue(okResponse(500, "boom"));

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: {},
      });

      // The only long timer left is the request's own abort ceiling (30s).
      // Anything else — notably the 2^attempt backoff, 2000ms here — would be
      // the in-process retry that never fired on serverless coming back.
      const backoffTimers = setTimeoutSpy.mock.calls.filter(
        ([, delay]) =>
          typeof delay === "number" && delay >= 1000 && delay !== 30_000,
      );
      expect(backoffTimers).toHaveLength(0);
      setTimeoutSpy.mockRestore();
    });
  });

  describe("sweepDueRetries", () => {
    const dueDelivery = {
      id: "delivery-1",
      webhook_id: "webhook-1",
      event_type: WEBHOOK_EVENTS.CONTENT_UPDATED,
      payload: { event: "content.updated", data: {} },
      attempt_number: 1,
      status: "retrying",
      next_retry_at: new Date(Date.now() - 1000).toISOString(),
      webhooks: {
        id: "webhook-1",
        site_id: "site-123",
        url: "https://example.com/webhook",
        secret: "secret-key",
        failure_count: 1,
        max_failures: 5,
        is_active: true,
      },
    };

    it("selects only attempts that are retrying and already due", async () => {
      resultsByTable.webhook_deliveries = { data: [], error: null };

      const result = await webhookManager.sweepDueRetries();

      expect(calls.eq).toHaveBeenCalledWith("status", "retrying");
      expect(calls.lte).toHaveBeenCalledWith(
        "next_retry_at",
        expect.any(String),
      );
      expect(result).toEqual({ retried: 0 });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    /**
     * A retry UPDATES the original row rather than inserting a new one. Today's
     * `retryWebhook` inserted a fresh row per attempt, which is why "Attempt 2
     * of 5" could not correspond to any single thing in the history list.
     */
    it("updates the original row on a successful retry, never inserts a second", async () => {
      resultsByTable.webhook_deliveries = { data: [dueDelivery], error: null };
      mockFetch.mockResolvedValue(okResponse());

      const result = await webhookManager.sweepDueRetries();

      expect(result).toEqual({ retried: 1 });
      expect(calls.insert).not.toHaveBeenCalled();
      expect(calls.eq).toHaveBeenCalledWith("id", "delivery-1");
      expect(calls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "delivered",
          success: true,
          attempt_number: 2,
          next_retry_at: null,
        }),
      );
    });

    it("re-arms the backoff when the retry fails short of the limit", async () => {
      resultsByTable.webhook_deliveries = { data: [dueDelivery], error: null };
      mockFetch.mockResolvedValue(okResponse(503, "unavailable"));
      const before = Date.now();

      await webhookManager.sweepDueRetries();

      const update = calls.update.mock.calls[0][0] as {
        status: string;
        next_retry_at: string;
      };
      expect(update.status).toBe("retrying");
      // Attempt 2 failed → 2^2 * 1000ms.
      const due = new Date(update.next_retry_at).getTime();
      expect(due).toBeGreaterThanOrEqual(before + 4000);
      expect(due).toBeLessThanOrEqual(Date.now() + 4000);
    });

    it("marks the delivery failed once the attempt limit is spent and stops retrying", async () => {
      resultsByTable.webhook_deliveries = {
        data: [{ ...dueDelivery, attempt_number: 4 }],
        error: null,
      };
      mockFetch.mockRejectedValue(new Error("Network error"));

      await webhookManager.sweepDueRetries();

      expect(calls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          attempt_number: 5,
          next_retry_at: null,
        }),
      );
    });

    it("gives up without sending when the webhook behind the delivery is gone", async () => {
      resultsByTable.webhook_deliveries = {
        data: [{ ...dueDelivery, webhooks: null }],
        error: null,
      };

      await webhookManager.sweepDueRetries();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(calls.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", next_retry_at: null }),
      );
    });
  });

  /**
   * DELIVERY-TIME SSRF (AC 5, second half).
   *
   * A URL validated when it was saved proves nothing at send time: DNS is
   * attacker-controlled in between. `build.example.com` can resolve to a public
   * address the day the owner configures it and to 169.254.169.254 an hour
   * later — that is DNS rebinding, and a configuration-time-only check is
   * exactly the shape it defeats. Every outbound path re-resolves immediately
   * before it fetches, and refuses without fetching.
   */
  describe("SSRF re-check immediately before sending", () => {
    const webhook = {
      id: "webhook-1",
      site_id: "site-123",
      url: "https://rebound.example.com/webhook",
      secret: "secret-key",
      failure_count: 0,
      max_failures: 5,
    };

    /** The endpoint's DNS record has flipped to the metadata service. */
    const rebound = () =>
      mockLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    it("blocks a first delivery and records why, without fetching", async () => {
      rebound();
      resultsByTable.webhooks = { data: [webhook], error: null };
      resultsByTable.webhook_deliveries = { data: { id: "d-1" }, error: null };

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: {},
      });

      expect(mockFetch).not.toHaveBeenCalled();
      const inserted = calls.insert.mock.calls[0][0] as {
        success: boolean;
        error_message: string;
      };
      expect(inserted.success).toBe(false);
      // Reads differently from "your server didn't respond" on purpose.
      expect(inserted.error_message).toMatch(/at send time/i);
      expect(inserted.error_message).toMatch(/DNS rebinding/i);
      expect(inserted.error_message).toContain("169.254.169.254");
    });

    it("blocks a retry the same way", async () => {
      rebound();
      resultsByTable.webhook_deliveries = {
        data: [
          {
            id: "delivery-1",
            webhook_id: "webhook-1",
            event_type: WEBHOOK_EVENTS.CONTENT_UPDATED,
            payload: { event: "content.updated", data: {} },
            attempt_number: 1,
            status: "retrying",
            next_retry_at: new Date(Date.now() - 1000).toISOString(),
            webhooks: { ...webhook, is_active: true },
          },
        ],
        error: null,
      };

      await webhookManager.sweepDueRetries();

      expect(mockFetch).not.toHaveBeenCalled();
      const update = calls.update.mock.calls[0][0] as { error_message: string };
      expect(update.error_message).toMatch(/DNS rebinding/i);
    });

    it("blocks a manual test delivery the same way", async () => {
      rebound();
      resultsByTable.webhooks = { data: webhook, error: null };
      resultsByTable.webhook_deliveries = { error: null };

      const result = await webhookManager.testWebhook("webhook-1");

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/DNS rebinding/i);
    });

    it("does not cache the configuration-time verdict across the gap", async () => {
      // Same webhook, two sweeps: public first, rebound second. The second must
      // be refused, which is only possible if the check runs every time.
      resultsByTable.webhooks = { data: [webhook], error: null };
      resultsByTable.webhook_deliveries = { data: { id: "d-1" }, error: null };
      mockFetch.mockResolvedValue(okResponse());

      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: {},
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      rebound();
      await webhookManager.triggerEvent({
        siteId: "site-123",
        eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
        payload: {},
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
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
