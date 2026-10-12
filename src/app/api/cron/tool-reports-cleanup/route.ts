/**
 * GET /api/cron/tool-reports-cleanup — the daily trim of `tool_reports`
 * (vercel.json, 03:15 UTC; s96, ADR 062).
 *
 * Reports live 30 days, and the table keeps at most 5,000 rows: at ≤ 16 KB a
 * row that is ≤ 80 MB on Supabase Free's 500 MB, where going over makes the
 * WHOLE database read-only. `prune_tool_reports` deletes the expired rows,
 * then the oldest live rows past the ceiling, in one statement (two deletes
 * are a multi-step write, AGENTS.md). It is SECURITY INVOKER and only the
 * service role may execute it, which ADR 062 grants this route after the
 * fail-closed bearer check below.
 *
 * Idempotent: a retried delivery finds nothing left to delete and answers 200
 * with zero counts.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** The row ceiling (plan decision 8). */
const TOOL_REPORTS_MAX_ROWS = 5000;

export async function GET(request: NextRequest) {
  // Constant-time and fail-closed: see isAuthorizedCronRequest (s77).
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await createServiceRoleClient().rpc(
      "prune_tool_reports",
      { p_max_rows: TOOL_REPORTS_MAX_ROWS },
    );
    if (error) {
      console.error("[cron/tool-reports-cleanup] prune failed:", error.code);
      return NextResponse.json(
        { success: false, error: "Failed to prune tool reports" },
        { status: 500 },
      );
    }
    const counts = (Array.isArray(data) ? data[0] : data) as {
      expired?: number | string;
      trimmed?: number | string;
    } | null;
    const expired = Number(counts?.expired ?? 0);
    const trimmed = Number(counts?.trimmed ?? 0);
    console.info("[cron/tool-reports-cleanup] pruned", { expired, trimmed });
    return NextResponse.json({ success: true, expired, trimmed });
  } catch (error) {
    console.error(
      "[cron/tool-reports-cleanup] prune failed:",
      (error as Error).name,
    );
    return NextResponse.json(
      { success: false, error: "Failed to prune tool reports" },
      { status: 500 },
    );
  }
}
