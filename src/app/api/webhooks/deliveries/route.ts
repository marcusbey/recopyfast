/**
 * GET /api/webhooks/deliveries?webhookId=... — recent delivery history (AC 1).
 *
 * A delivery row carries the customer endpoint's response body and any error
 * text, so it is not readable by whoever happens to know a webhook id: the
 * caller must hold edit or admin permission on the webhook's site, the same bar
 * as configuring it.
 *
 * Read-only and unmetered on purpose — it is a first-party dashboard read that
 * costs one indexed query, not a write and not a public surface.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { webhookManager } from "@/lib/webhooks/manager";
import { requireWebhookSitePermission } from "@/lib/webhooks/access";

/** Matches the design's "Recent deliveries" list: a short, scannable history. */
const DELIVERY_HISTORY_LIMIT = 20;

export async function GET(req: NextRequest) {
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
      .select("site_id")
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

    const deliveries = await webhookManager.getDeliveryLogs(
      webhookId,
      DELIVERY_HISTORY_LIMIT,
    );

    return NextResponse.json({ deliveries });
  } catch (error) {
    console.error("Get webhook deliveries error:", error);
    return NextResponse.json(
      { error: "Failed to fetch webhook deliveries" },
      { status: 500 },
    );
  }
}
