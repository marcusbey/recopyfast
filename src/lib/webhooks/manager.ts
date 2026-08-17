import { createServerClient } from "@supabase/ssr";
import { Webhook, WebhookDelivery, WebhookDeliveryStatus } from "@/types";
import {
  assertSafeWebhookUrl,
  describeDeliveryRefusal,
} from "@/lib/security/webhook-url-safety";
import crypto from "crypto";

type WebhookRow = Pick<
  Webhook,
  | "id"
  | "site_id"
  | "url"
  | "events"
  | "secret"
  | "failure_count"
  | "max_failures"
>;

/** A webhook with the coalescing-window state the sweep reads. */
type PendingWebhookRow = WebhookRow &
  Pick<
    Webhook,
    "pending_event_type" | "pending_payload" | "pending_dispatch_at"
  >;

/** A delivery row joined to the webhook it belongs to, as the retry sweep reads it. */
type DueRetryRow = Pick<
  WebhookDelivery,
  "id" | "event_type" | "payload" | "attempt_number"
> & {
  webhooks: (WebhookRow & { is_active?: boolean }) | null;
};

/** The result of one HTTP attempt, before it is written anywhere. */
interface DeliveryOutcome {
  success: boolean;
  responseStatus?: number;
  responseBody?: string;
  responseTime?: number;
  errorMessage?: string;
}

/** Default width of the edit-coalescing window, restated in the UI (AC 4). */
export const DEFAULT_COALESCE_WINDOW_SECONDS = 30;

/**
 * How many times one delivery is attempted before it is marked failed (AC 3).
 *
 * Matches the `max_failures` default so the UI's "gave up after 5 attempts" and
 * the webhook's own auto-disable threshold agree. The two remain distinct
 * concepts — see handleWebhookFailure.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Ceiling on one outbound request, so a hanging endpoint cannot stall a sweep. */
const DELIVERY_TIMEOUT_MS = 30_000;

/** Retries handled per cron tick. Bounded so one tick cannot run unboundedly long. */
const RETRY_SWEEP_BATCH_SIZE = 50;

/**
 * Columns the list path may read.
 *
 * `secret` is deliberately absent. `getWebhooks` used to `select("*")`, which
 * re-served the plaintext signing secret on every dashboard load — a secret
 * documented as "shown once at creation" and in fact shown on every page view.
 * Add columns here by name; never restore the wildcard.
 */
const WEBHOOK_LIST_COLUMNS = [
  "id",
  "site_id",
  "url",
  "events",
  "secret_prefix",
  "is_active",
  "last_triggered_at",
  "failure_count",
  "max_failures",
  "coalesce_window_seconds",
  "pending_dispatch_at",
  "created_by",
  "created_at",
  "updated_at",
].join(", ");

export class WebhookManager {
  private _supabase: ReturnType<typeof createServerClient> | null = null;

  // Lazy: construct the Supabase client on first use, not at instantiation. This
  // module exports a singleton at import time, and createServerClient throws on
  // empty url/key — which crashed Vercel's "Collecting page data" build phase when
  // Supabase env vars are absent. Deferring avoids the import-time throw.
  private get supabase() {
    if (!this._supabase) {
      this._supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          cookies: {
            get: () => "",
            set: () => {},
            remove: () => {},
          },
        },
      );
    }
    return this._supabase;
  }

  /**
   * Create a new webhook.
   *
   * There is deliberately no `secret` parameter. This method used to accept one
   * and generate a secret only when it was absent, so the value signing every
   * delivery could be chosen — or reused across sites — by whoever called the
   * route. The plaintext secret is returned exactly once, here, and never
   * again: `getWebhooks` does not select the column.
   *
   * Unlike `api_keys.key_hash`, the secret is stored in plaintext. That is not
   * an oversight: `deliverWebhook` has to recover it to compute an HMAC at send
   * time, and a hash cannot be reversed for that. What is copied from the
   * API-key shape is the show-once *behaviour*, not the hashing *mechanism*.
   */
  async createWebhook(params: {
    siteId: string;
    url: string;
    events: string[];
    createdBy: string;
    coalesceWindowSeconds?: number;
  }): Promise<Webhook> {
    const secret = this.generateSecret();

    const { data: webhook, error } = await this.supabase
      .from("webhooks")
      .insert({
        site_id: params.siteId,
        url: params.url,
        events: params.events,
        secret,
        // Displayed after the show-once moment so an owner can tell which
        // secret a given webhook holds without it being re-served in full.
        secret_prefix: secret.slice(0, 8),
        coalesce_window_seconds:
          params.coalesceWindowSeconds ?? DEFAULT_COALESCE_WINDOW_SECONDS,
        created_by: params.createdBy,
        is_active: true,
        failure_count: 0,
        max_failures: 5,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // The generated secret is attached from here rather than trusted to come
    // back on the inserted row, so the show-once route cannot be silently
    // broken by a change to what the insert selects.
    return { ...(webhook as Webhook), secret };
  }

  /**
   * Update webhook
   */
  async updateWebhook(
    webhookId: string,
    updates: Partial<Webhook>,
  ): Promise<Webhook> {
    const { data: webhook, error } = await this.supabase
      .from("webhooks")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", webhookId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return webhook;
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    const { error } = await this.supabase
      .from("webhooks")
      .delete()
      .eq("id", webhookId);

    if (error) {
      throw error;
    }
  }

  /**
   * Get webhooks for a site. Never returns the signing secret — see
   * WEBHOOK_LIST_COLUMNS for why the wildcard is gone.
   */
  async getWebhooks(siteId: string): Promise<Webhook[]> {
    const { data: webhooks, error } = await this.supabase
      .from("webhooks")
      .select(WEBHOOK_LIST_COLUMNS)
      .eq("site_id", siteId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    // Defence in depth against a database — or a future migration — that hands
    // back more than was asked for. The plaintext secret leaves this class
    // through exactly one door: createWebhook's return value.
    return ((webhooks || []) as unknown as Webhook[]).map((webhook) => {
      const withoutSecret = { ...webhook };
      delete withoutSecret.secret;
      return withoutSecret;
    });
  }

  /**
   * Trigger webhook for an event
   */
  async triggerEvent(params: {
    siteId: string;
    eventType: string;
    payload: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      // Get active webhooks for this site and event
      const { data: webhooks, error } = await this.supabase
        .from("webhooks")
        .select("*")
        .eq("site_id", params.siteId)
        .eq("is_active", true)
        .contains("events", [params.eventType]);

      if (error) {
        console.error("Failed to get webhooks:", error);
        return;
      }

      if (!webhooks || webhooks.length === 0) {
        return; // No webhooks for this event
      }

      // Trigger each webhook
      const deliveryPromises = (webhooks as WebhookRow[]).map((webhook) =>
        this.deliverWebhook(
          webhook,
          params.eventType,
          params.payload,
          params.metadata,
        ),
      );

      await Promise.allSettled(deliveryPromises);
    } catch (error) {
      console.error("Failed to trigger webhook event:", error);
    }
  }

  /**
   * Mark that something happened which a webhook cares about (ADR 010, phase 1).
   *
   * This is a marker, not a delivery: it opens — or joins — a coalescing window
   * and returns. It is called from inside `after()` on the publish path, so it
   * must never throw and must never be slow: the edit that triggered it has
   * already been answered, and there is no response left to shape (AC 6).
   *
   * The window is a THROTTLE, not a debounce. `pending_dispatch_at` is set once,
   * by the first qualifying event, and is not pushed forward by later ones. A
   * debounce that resets on every edit has no upper bound on latency under
   * continuous editing — for a "rebuild my site" trigger that is a worse failure
   * than delivering slightly early with a merged payload.
   */
  async recordQualifyingEvent(params: {
    siteId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      const { data: webhooks, error } = await this.supabase
        .from("webhooks")
        .select("id, coalesce_window_seconds, pending_dispatch_at")
        .eq("site_id", params.siteId)
        .eq("is_active", true)
        .contains("events", [params.eventType]);

      if (error) {
        console.error("Failed to load webhooks for coalescing:", error);
        return;
      }

      const rows = (webhooks || []) as unknown as Array<{
        id: string;
        coalesce_window_seconds: number | null;
        pending_dispatch_at: string | null;
      }>;

      await Promise.allSettled(
        rows.map((row) => {
          const isWindowOpen = Boolean(row.pending_dispatch_at);
          const windowSeconds =
            row.coalesce_window_seconds ?? DEFAULT_COALESCE_WINDOW_SECONDS;

          const update: Record<string, unknown> = {
            pending_payload: params.payload,
          };

          if (!isWindowOpen) {
            update.pending_event_type = params.eventType;
            update.pending_dispatch_at = new Date(
              Date.now() + windowSeconds * 1000,
            ).toISOString();
          }

          return this.supabase.from("webhooks").update(update).eq("id", row.id);
        }),
      );
    } catch (error) {
      // Swallowed on purpose: this runs after the response has been committed.
      console.error("Failed to record qualifying webhook event:", error);
    }
  }

  /**
   * Fire every coalescing window that has elapsed (ADR 010, phase 2).
   *
   * Called by /api/cron/webhook-dispatch. The pending state is cleared whether
   * the delivery succeeded or not — once a delivery row exists, retry is that
   * row's business (`sweepDueRetries`), not the window's. Leaving the window set
   * on failure would re-send the same coalesced payload on every tick forever.
   */
  async sweepDueDispatches(): Promise<{ dispatched: number }> {
    const { data: webhooks, error } = await this.supabase
      .from("webhooks")
      .select("*")
      .eq("is_active", true)
      .lte("pending_dispatch_at", new Date().toISOString());

    if (error) {
      console.error("Failed to load due webhook dispatches:", error);
      return { dispatched: 0 };
    }

    const due = (webhooks || []) as unknown as PendingWebhookRow[];
    let dispatched = 0;

    for (const webhook of due) {
      if (!webhook.pending_event_type) continue;

      try {
        await this.deliverWebhook(
          webhook,
          webhook.pending_event_type,
          (webhook.pending_payload as Record<string, unknown>) ?? {},
        );
        dispatched += 1;
      } finally {
        await this.supabase
          .from("webhooks")
          .update({
            pending_event_type: null,
            pending_payload: null,
            pending_dispatch_at: null,
          })
          .eq("id", webhook.id);
      }
    }

    return { dispatched };
  }

  /**
   * One HTTP attempt at one endpoint. Never throws — every failure comes back
   * as an outcome so the caller can persist it.
   */
  private async attemptDelivery(params: {
    webhook: WebhookRow;
    eventType: string;
    envelope: Record<string, unknown>;
    isRetry: boolean;
  }): Promise<DeliveryOutcome> {
    const requestPayload = JSON.stringify(params.envelope);
    const signature = this.generateSignature(
      requestPayload,
      params.webhook.secret || "",
    );

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "ReCopyFast-Webhooks/1.0",
      "X-ReCopyFast-Event": params.eventType,
      "X-ReCopyFast-Signature": signature,
      "X-ReCopyFast-Delivery": crypto.randomUUID(),
    };
    if (params.isRetry) headers["X-ReCopyFast-Retry"] = "true";

    const startTime = Date.now();

    // AC 5, second half. Re-resolved here, immediately before the fetch, and
    // deliberately not cached from configuration time: a hostname that was
    // public when the owner saved it can point at 169.254.169.254 by the time
    // we send. This is the only thing standing between a rebound DNS record and
    // our own network position.
    const safety = await assertSafeWebhookUrl(params.webhook.url);
    if (!safety.ok) {
      return {
        success: false,
        responseTime: 0,
        errorMessage: describeDeliveryRefusal(safety.error),
      };
    }

    try {
      const response = await fetch(params.webhook.url, {
        method: "POST",
        headers,
        body: requestPayload,
        // A slow or hanging endpoint must not hold anything open (AC 6). This
        // runs on a cron tick, not in the edit's request, but the ceiling still
        // matters: without it one dead endpoint stalls the whole sweep.
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });

      const responseBody = await response.text().catch(() => "");

      return {
        success: response.ok,
        responseStatus: response.status,
        responseBody: responseBody.substring(0, 1000),
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        responseTime: Date.now() - startTime,
        errorMessage:
          error instanceof Error ? error.message : "Unknown delivery error",
      };
    }
  }

  /**
   * Where an attempt leaves the delivery row.
   *
   * This is the whole retry engine now. It used to be
   * `setTimeout(() => this.retryWebhook(...), delay)` — with delays up to five
   * minutes, inside a serverless invocation that ends with its response. That
   * timer never fired in production, and nothing recorded that it hadn't. The
   * backoff formula below is unchanged; only what triggers it moved, from an
   * in-process timer to a column plus a cron sweep (ADR 010).
   */
  private resolveRetryState(
    attemptNumber: number,
    success: boolean,
  ): { status: WebhookDeliveryStatus; next_retry_at: string | null } {
    if (success) {
      return { status: "delivered", next_retry_at: null };
    }

    if (attemptNumber >= MAX_DELIVERY_ATTEMPTS) {
      // Marked failed and kept — an owner has to be able to see that we gave
      // up, which means the row is never pruned (AC 3).
      return { status: "failed", next_retry_at: null };
    }

    return {
      status: "retrying",
      next_retry_at: new Date(
        Date.now() + this.calculateRetryDelay(attemptNumber),
      ).toISOString(),
    };
  }

  /**
   * Deliver webhook to a specific endpoint — first attempt.
   */
  private async deliverWebhook(
    webhook: WebhookRow,
    eventType: string,
    payload: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const envelope: Record<string, unknown> = {
      event: eventType,
      timestamp: new Date().toISOString(),
      site_id: webhook.site_id,
      data: payload,
      metadata,
    };

    const outcome = await this.attemptDelivery({
      webhook,
      eventType,
      envelope,
      isRetry: false,
    });

    const retryState = this.resolveRetryState(1, outcome.success);

    const delivery: Partial<WebhookDelivery> = {
      webhook_id: webhook.id,
      event_type: eventType,
      payload: envelope,
      attempt_number: 1,
      success: outcome.success,
      status: retryState.status,
      next_retry_at: retryState.next_retry_at,
      response_status: outcome.responseStatus,
      response_body: outcome.responseBody,
      response_time: outcome.responseTime,
      error_message: outcome.errorMessage,
    };

    await this.supabase.from("webhook_deliveries").insert(delivery);

    if (outcome.success) {
      await this.supabase
        .from("webhooks")
        .update({
          last_triggered_at: new Date().toISOString(),
          failure_count: 0, // Reset failure count on success
        })
        .eq("id", webhook.id);
    } else {
      await this.handleWebhookFailure(webhook);
    }
  }

  /**
   * Re-attempt every delivery whose backoff has elapsed (ADR 010, phase 2).
   *
   * A retry UPDATES the original row — same id, incremented attempt number —
   * rather than inserting a new one per attempt as `retryWebhook` did. "Attempt
   * 2 of 5" has to correspond to one thing in the history list, and with a row
   * per attempt it corresponded to none.
   */
  async sweepDueRetries(): Promise<{ retried: number }> {
    const { data: deliveries, error } = await this.supabase
      .from("webhook_deliveries")
      .select(
        "*, webhooks(id, site_id, url, secret, failure_count, max_failures, is_active)",
      )
      .eq("status", "retrying")
      .lte("next_retry_at", new Date().toISOString())
      .limit(RETRY_SWEEP_BATCH_SIZE);

    if (error) {
      console.error("Failed to load due webhook retries:", error);
      return { retried: 0 };
    }

    const due = (deliveries || []) as unknown as DueRetryRow[];
    let retried = 0;

    for (const row of due) {
      const webhook = row.webhooks;
      const attemptNumber = (row.attempt_number || 1) + 1;

      // The webhook was deleted or auto-disabled between attempts. There is
      // nothing left to deliver to, and a row left `retrying` would be swept
      // again on every tick forever.
      if (!webhook || webhook.is_active === false) {
        await this.supabase
          .from("webhook_deliveries")
          .update({
            status: "failed",
            next_retry_at: null,
            attempt_number: attemptNumber,
            success: false,
            error_message:
              "Webhook is no longer active — remaining attempts abandoned.",
          })
          .eq("id", row.id);
        continue;
      }

      const outcome = await this.attemptDelivery({
        webhook,
        eventType: row.event_type,
        envelope: row.payload,
        isRetry: true,
      });

      const retryState = this.resolveRetryState(attemptNumber, outcome.success);

      await this.supabase
        .from("webhook_deliveries")
        .update({
          attempt_number: attemptNumber,
          success: outcome.success,
          status: retryState.status,
          next_retry_at: retryState.next_retry_at,
          response_status: outcome.responseStatus ?? null,
          response_body: outcome.responseBody ?? null,
          response_time: outcome.responseTime ?? null,
          error_message: outcome.errorMessage ?? null,
        })
        .eq("id", row.id);

      if (outcome.success) {
        await this.supabase
          .from("webhooks")
          .update({
            last_triggered_at: new Date().toISOString(),
            failure_count: 0,
          })
          .eq("id", webhook.id);
      } else {
        await this.handleWebhookFailure(webhook);
      }

      retried += 1;
    }

    return { retried };
  }

  /**
   * Webhook-level failure bookkeeping: count failures, disable the webhook once
   * it has failed too often.
   *
   * Distinct from the delivery's own retry state, and deliberately so:
   * `failure_count`/`max_failures` govern disabling the *webhook* across
   * deliveries, `MAX_DELIVERY_ATTEMPTS` governs retrying *one* delivery. They
   * share the number 5 so the UI's "gave up after 5 attempts" and the
   * auto-disable threshold agree; they are not the same concept.
   */
  private async handleWebhookFailure(webhook: WebhookRow): Promise<void> {
    const newFailureCount = webhook.failure_count + 1;

    if (newFailureCount >= webhook.max_failures) {
      // Disable webhook after max failures
      await this.supabase
        .from("webhooks")
        .update({
          is_active: false,
          failure_count: newFailureCount,
        })
        .eq("id", webhook.id);
      return;
    }

    await this.supabase
      .from("webhooks")
      .update({
        failure_count: newFailureCount,
      })
      .eq("id", webhook.id);
  }

  /**
   * Calculate retry delay using exponential backoff
   */
  private calculateRetryDelay(attemptNumber: number): number {
    // Exponential backoff: 2^attempt * 1000ms, max 5 minutes
    return Math.min(Math.pow(2, attemptNumber) * 1000, 5 * 60 * 1000);
  }

  /**
   * Generate webhook signature
   */
  private generateSignature(payload: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );
  }

  /**
   * Generate secure webhook secret
   */
  private generateSecret(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Get webhook delivery logs
   */
  async getDeliveryLogs(
    webhookId: string,
    limit: number = 50,
  ): Promise<WebhookDelivery[]> {
    const { data: deliveries, error } = await this.supabase
      .from("webhook_deliveries")
      .select("*")
      .eq("webhook_id", webhookId)
      .order("delivered_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return deliveries || [];
  }

  /**
   * Test webhook endpoint
   */
  async testWebhook(webhookId: string): Promise<{
    success: boolean;
    statusCode?: number;
    responseTime?: number;
    error?: string;
  }> {
    try {
      const { data: webhook, error } = await this.supabase
        .from("webhooks")
        .select("*")
        .eq("id", webhookId)
        .single();

      if (error || !webhook) {
        return { success: false, error: "Webhook not found" };
      }

      const testPayload = {
        event: "test",
        timestamp: new Date().toISOString(),
        site_id: webhook.site_id,
        data: { message: "This is a test webhook delivery" },
      };

      // Same re-check as every other outbound path (AC 5). The manual test
      // button is the easiest of the three to point at an internal address, and
      // an unchecked one would make it a probe rather than a test.
      const safety = await assertSafeWebhookUrl(webhook.url);
      if (!safety.ok) {
        const reason = describeDeliveryRefusal(safety.error);
        await this.supabase.from("webhook_deliveries").insert({
          webhook_id: webhookId,
          event_type: "test",
          payload: testPayload,
          success: false,
          status: "failed",
          next_retry_at: null,
          attempt_number: 1,
          error_message: reason,
        });
        return { success: false, error: reason };
      }

      const startTime = Date.now();
      const payloadString = JSON.stringify(testPayload);
      const signature = this.generateSignature(
        payloadString,
        webhook.secret || "",
      );

      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ReCopyFast-Webhooks/1.0",
          "X-ReCopyFast-Event": "test",
          "X-ReCopyFast-Signature": signature,
          "X-ReCopyFast-Test": "true",
        },
        body: payloadString,
        signal: AbortSignal.timeout(10000), // 10 second timeout for tests
      });

      const responseTime = Date.now() - startTime;

      // Log test delivery. A manual test is never retried — the owner is
      // standing there and can press the button again — so it resolves
      // immediately to delivered or failed and arms no backoff.
      await this.supabase.from("webhook_deliveries").insert({
        webhook_id: webhookId,
        event_type: "test",
        payload: testPayload,
        response_status: response.status,
        response_time: responseTime,
        success: response.ok,
        status: response.ok ? "delivered" : "failed",
        next_retry_at: null,
        attempt_number: 1,
      });

      return {
        success: response.ok,
        statusCode: response.status,
        responseTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

// Event types that can trigger webhooks
export const WEBHOOK_EVENTS = {
  CONTENT_UPDATED: "content.updated",
  CONTENT_CREATED: "content.created",
  CONTENT_DELETED: "content.deleted",
  SITE_UPDATED: "site.updated",
  USER_INVITED: "user.invited",
  TEAM_MEMBER_ADDED: "team.member_added",
  BULK_OPERATION_COMPLETED: "bulk.operation_completed",
  AB_TEST_STARTED: "ab_test.started",
  AB_TEST_COMPLETED: "ab_test.completed",
} as const;

export type WebhookEventType =
  (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS];

// Export singleton instance
export const webhookManager = new WebhookManager();
