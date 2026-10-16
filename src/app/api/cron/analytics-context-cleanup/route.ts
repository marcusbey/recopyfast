import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";
export const dynamic = "force-dynamic";

/** Independent of conversion delivery: expired attribution never needs an outbox. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { data, error } = await createServiceRoleClient().rpc(
      "cleanup_analytics_contexts",
      { p_limit: 1000 },
    );
    if (error) throw new Error("cleanup");
    const row = Array.isArray(data) ? data[0] : data;
    const deleted = Number(row?.deleted ?? 0),
      overdue = Number(row?.overdue ?? 0);
    if (overdue > 0)
      console.error("[analytics/context] cleanup overdue", { overdue });
    return NextResponse.json({ success: true, deleted, overdue });
  } catch {
    console.error("[analytics/context] cleanup unavailable");
    return NextResponse.json({ error: "Cleanup unavailable" }, { status: 503 });
  }
}
