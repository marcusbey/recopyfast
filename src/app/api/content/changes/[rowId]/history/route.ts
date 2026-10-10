/**
 * GET /api/content/changes/[rowId]/history — one row's trail (s70b).
 *
 * `staging_history` has recorded every draft save and every publish since the
 * staging workflow (one row each, written atomically by the save and publish
 * RPCs), and nothing read it: the old Content card's History button was never
 * rendered. The Changes page loads this on a row's first expand.
 *
 * Read-only, on the signed-in user's client; the service role is never
 * imported. RLS decides twice: the row itself (any member of its site) and its
 * history (the site's admins only, 20251230000000). A non-admin is told that
 * history is admin-only — `historyVisible: false` — rather than being shown an
 * empty trail that reads as "nobody ever changed this".
 */

import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requireUuid } from "@/lib/api/validation";
import { createClient } from "@/lib/supabase/server";

/** The design's list: the newest 20, then "Discovered". */
const MAX_EVENTS = 20;
const FAILURE = "Failed to load history";

interface RouteContext {
  params: Promise<{ rowId: string }>;
}

interface HistoryRow {
  id: string;
  action: string | null;
  user_email: string | null;
  previous_content: string | null;
  new_content: string | null;
  created_at: string;
}

/**
 * `user_email` can hold a user id or an access kind
 * (`access.email || access.userId || access.kind`, staging PUT): only an
 * address is a "who".
 */
function emailOrNull(value: string | null): string | null {
  return value && value.includes("@") ? value : null;
}

function failure(context: string, error: unknown): NextResponse {
  console.error(`content/changes/history: ${context}`, error);
  return NextResponse.json({ error: FAILURE }, { status: 500 });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    // Before getUser(), as the list route: per IP, fail-open, because this is
    // a signed-in, read-only, 20-row read that a Redis blip must not blank.
    const limited = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "content/changes/history",
      identifierType: "ip",
      onStoreFailure: "allow",
    });
    if (limited) return limited;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rowId: rawRowId } = await context.params;
    const rowId = requireUuid({ rowId: rawRowId }, "rowId");
    if (!rowId.ok) {
      return NextResponse.json({ error: "Invalid row id" }, { status: 400 });
    }

    // Through RLS: a row of a site the caller is not a member of is simply
    // not returned, and that is a 404, never a hint that it exists.
    const { data: row, error: rowError } = await supabase
      .from("content_elements")
      .select("id, site_id, created_at")
      .eq("id", rowId.value)
      .maybeSingle<{ id: string; site_id: string; created_at: string }>();
    if (rowError) return failure("row read failed", rowError);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: grant, error: grantError } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", row.site_id)
      .eq("user_id", user.id)
      .maybeSingle<{ permission: string }>();
    if (grantError) return failure("grant read failed", grantError);

    if (grant?.permission !== "admin") {
      return NextResponse.json({
        historyVisible: false,
        events: [],
        discoveredAt: row.created_at,
      });
    }

    const { data: history, error: historyError } = await supabase
      .from("staging_history")
      .select(
        "id, action, user_email, previous_content, new_content, created_at",
      )
      .eq("content_element_id", row.id)
      .order("created_at", { ascending: false })
      .limit(MAX_EVENTS);
    if (historyError) return failure("history read failed", historyError);

    return NextResponse.json({
      historyVisible: true,
      discoveredAt: row.created_at,
      events: ((history ?? []) as HistoryRow[]).map((event) => ({
        id: event.id,
        action: event.action,
        by: emailOrNull(event.user_email),
        at: event.created_at,
        previous: event.previous_content,
        content: event.new_content,
      })),
    });
  } catch (error) {
    return failure("unexpected error", error);
  }
}
