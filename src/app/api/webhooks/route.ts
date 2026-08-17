/**
 * /api/webhooks — outbound webhook configuration for one site.
 *
 * NOT to be confused with `./stripe/route.ts`, which shares this directory and
 * nothing else: that one receives Stripe's events, this one configures the
 * calls we make to a customer's build system. A grep for "webhooks" without a
 * path filter finds both, which is exactly how they would end up entangled.
 *
 * Three things this route did before and does not do now:
 *   - returned the plaintext signing secret on every GET (see manager.ts);
 *   - spread `{ webhook_id, ...updates }` into the update, so `secret` and
 *     `failure_count` were caller-settable — the second of which re-arms a
 *     webhook the platform had auto-disabled;
 *   - validated the URL with `new URL()` alone, which accepts
 *     http://169.254.169.254/ (see lib/security/webhook-url-safety.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  webhookManager,
  WEBHOOK_EVENTS,
  WebhookEventType,
} from "@/lib/webhooks/manager";
import { requireWebhookSitePermission } from "@/lib/webhooks/access";
import { assertSafeWebhookUrl } from "@/lib/security/webhook-url-safety";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { readJsonObject, requireUuid } from "@/lib/api/validation";

/** Bounds on the coalescing window. The UI offers 10s–5min inside this range. */
const MIN_COALESCE_WINDOW_SECONDS = 10;
const MAX_COALESCE_WINDOW_SECONDS = 3600;

function validateEvents(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const allowed = Object.values(WEBHOOK_EVENTS);
  const events = value.filter(
    (event): event is string =>
      typeof event === "string" && allowed.includes(event as WebhookEventType),
  );

  return events.length === value.length ? events : null;
}

function validateCoalesceWindow(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_COALESCE_WINDOW_SECONDS ||
    value > MAX_COALESCE_WINDOW_SECONDS
  ) {
    return null;
  }
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");

    if (!siteId) {
      return NextResponse.json(
        { error: "Missing siteId parameter" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await requireWebhookSitePermission(supabase, siteId, user.id))) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const webhooks = await webhookManager.getWebhooks(siteId);
    return NextResponse.json(webhooks);
  } catch (error) {
    console.error("Get webhooks error:", error);
    return NextResponse.json(
      { error: "Failed to fetch webhooks" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  // Rate limit BEFORE authorization: auth itself costs a permissions lookup, so
  // a limiter behind it never sees the flood. `deny` on store failure — this
  // write creates an endpoint we will then call on a schedule, which is a
  // service-costing write, not a public read.
  const limited = await enforceRateLimit(req, {
    limit: "API_UPLOAD",
    endpoint: "webhooks/create",
    onStoreFailure: "deny",
  });
  if (limited) return limited;

  try {
    const parsed = await readJsonObject(req);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const body = parsed.value;

    const siteId = requireUuid(body, "site_id");
    if (!siteId.ok) {
      return NextResponse.json({ error: siteId.error }, { status: 400 });
    }

    const events = validateEvents(body.events);
    if (!events) {
      return NextResponse.json(
        {
          error:
            'Field "events" must be a non-empty array of known event types',
        },
        { status: 400 },
      );
    }

    let coalesceWindowSeconds: number | undefined;
    if (body.coalesce_window_seconds !== undefined) {
      const window = validateCoalesceWindow(body.coalesce_window_seconds);
      if (window === null) {
        return NextResponse.json(
          {
            error: `Field "coalesce_window_seconds" must be a whole number between ${MIN_COALESCE_WINDOW_SECONDS} and ${MAX_COALESCE_WINDOW_SECONDS}`,
          },
          { status: 400 },
        );
      }
      coalesceWindowSeconds = window;
    }

    // Configuration-time half of AC 5. The delivery-time half lives in
    // WebhookManager, and neither replaces the other: DNS moves in between.
    const safeUrl = await assertSafeWebhookUrl(
      typeof body.url === "string" ? body.url : "",
    );
    if (!safeUrl.ok) {
      return NextResponse.json({ error: safeUrl.error }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (
      !(await requireWebhookSitePermission(supabase, siteId.value, user.id))
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // No `secret` is passed, and createWebhook no longer accepts one: the
    // signing key is generated server-side or it is not trustworthy.
    const webhook = await webhookManager.createWebhook({
      siteId: siteId.value,
      url: safeUrl.value,
      events,
      createdBy: user.id,
      coalesceWindowSeconds,
    });

    // The only response in the system that carries the plaintext secret. Same
    // show-once shape as /api/api-keys, without its one-way hash: delivery has
    // to recover this value to sign with it.
    const { secret, ...withoutSecret } = webhook;

    return NextResponse.json(
      {
        webhook: withoutSecret,
        secret,
        warning:
          "Store this signing secret securely. It will not be shown again.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create webhook error:", error);
    return NextResponse.json(
      { error: "Failed to create webhook" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const parsed = await readJsonObject(req);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const body = parsed.value;

    const webhookId = requireUuid(body, "webhook_id");
    if (!webhookId.ok) {
      return NextResponse.json({ error: webhookId.error }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: webhook, error: webhookError } = await supabase
      .from("webhooks")
      .select("site_id, created_by")
      .eq("id", webhookId.value)
      .single();

    if (webhookError || !webhook) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    if (
      !(await requireWebhookSitePermission(supabase, webhook.site_id, user.id))
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // ALLOWLIST, not a spread. Everything absent from this object is
    // unreachable from the network — notably `secret` and `failure_count`.
    const updates: Record<string, unknown> = {};

    if (body.events !== undefined) {
      const events = validateEvents(body.events);
      if (!events) {
        return NextResponse.json(
          {
            error:
              'Field "events" must be a non-empty array of known event types',
          },
          { status: 400 },
        );
      }
      updates.events = events;
    }

    if (body.url !== undefined) {
      const safeUrl = await assertSafeWebhookUrl(
        typeof body.url === "string" ? body.url : "",
      );
      if (!safeUrl.ok) {
        return NextResponse.json({ error: safeUrl.error }, { status: 400 });
      }
      updates.url = safeUrl.value;
    }

    if (body.coalesce_window_seconds !== undefined) {
      const window = validateCoalesceWindow(body.coalesce_window_seconds);
      if (window === null) {
        return NextResponse.json(
          {
            error: `Field "coalesce_window_seconds" must be a whole number between ${MIN_COALESCE_WINDOW_SECONDS} and ${MAX_COALESCE_WINDOW_SECONDS}`,
          },
          { status: 400 },
        );
      }
      updates.coalesce_window_seconds = window;
    }

    if (typeof body.is_active === "boolean") {
      updates.is_active = body.is_active;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No updatable fields provided" },
        { status: 400 },
      );
    }

    const updatedWebhook = await webhookManager.updateWebhook(
      webhookId.value,
      updates,
    );
    return NextResponse.json(updatedWebhook);
  } catch (error) {
    console.error("Update webhook error:", error);
    return NextResponse.json(
      { error: "Failed to update webhook" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const webhookId = searchParams.get("webhookId");

    if (!webhookId) {
      return NextResponse.json(
        { error: "Missing webhookId parameter" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: webhook, error: webhookError } = await supabase
      .from("webhooks")
      .select("site_id, created_by")
      .eq("id", webhookId)
      .single();

    if (webhookError || !webhook) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    if (
      !(await requireWebhookSitePermission(supabase, webhook.site_id, user.id))
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    await webhookManager.deleteWebhook(webhookId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Delete webhook error:", error);
    return NextResponse.json(
      { error: "Failed to delete webhook" },
      { status: 500 },
    );
  }
}
