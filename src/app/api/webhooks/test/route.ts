/**
 * POST /api/webhooks/test — send one test delivery to a configured endpoint.
 *
 * The rate limit is the load-bearing part of this file. This endpoint makes our
 * infrastructure issue an HTTP request to an address the caller chose, on
 * demand. Unmetered, it is a free SSRF probe once the URL check exists to probe
 * against — and a free way to aim our egress at somebody else's server as fast
 * as a loop can press the button. `deny` on store failure: losing Redis must
 * not quietly remove the only control in front of that.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { webhookManager } from "@/lib/webhooks/manager";
import { requireWebhookSitePermission } from "@/lib/webhooks/access";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { readJsonObject, requireUuid } from "@/lib/api/validation";

export async function POST(req: NextRequest) {
  // Before authorization, deliberately: auth costs a permissions lookup, so a
  // limiter behind it never sees the flood.
  const limited = await enforceRateLimit(req, {
    limit: "API_UPLOAD",
    endpoint: "webhooks/test",
    onStoreFailure: "deny",
  });
  if (limited) return limited;

  try {
    const parsed = await readJsonObject(req);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const webhookId = requireUuid(parsed.value, "webhook_id");
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

    // testWebhook re-checks the URL against SSRF immediately before it sends,
    // exactly as the scheduled deliveries do.
    const testResult = await webhookManager.testWebhook(webhookId.value);

    return NextResponse.json(testResult);
  } catch (error) {
    console.error("Test webhook error:", error);
    return NextResponse.json(
      { error: "Failed to test webhook" },
      { status: 500 },
    );
  }
}
