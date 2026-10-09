/**
 * GET /api/cron/generate-blog-post — the daily blog DRAFT (vercel.json, 14:00
 * UTC). It never publishes.
 *
 * Until s89 this route fetched its own public URL (`NEXT_PUBLIC_APP_URL`) for a
 * topic, then POSTed it back to /api/blog/generate with the cron secret, and
 * that route inserted the model's post as `published` with no human in the
 * path — what the PRD calls "the fastest route to a site-wide quality
 * demotion" (docs/prd.md:320-322). It also wrote through the cookie-bound RLS
 * client with no session, i.e. as `anon`, which RLS refuses: every run paid
 * OpenAI and then failed (docs/research/s89-blog-drafts-only.md, fact 2).
 *
 * Now it drafts in-process (`createDailyDraft`) through the service role,
 * which ADR 057 grants this route only after the bearer check below. The draft
 * waits for a platform admin to publish it (POST /api/admin/blog/posts/[id],
 * runbook: docs/operations/blog.md). Nothing in the URL is read: there is no
 * parameter that could ask for a published post.
 *
 * Idempotent per UTC day: Vercel can deliver one scheduled run twice. A second
 * delivery answers `created: false` with the day's draft and does not call the
 * model. Fail-closed when CRON_SECRET is unset — an open endpoint here would
 * let anyone spend our OpenAI budget.
 */

import { NextRequest, NextResponse } from "next/server";
import { createDailyDraft } from "@/lib/blog/drafts";
import { isAuthorizedCronRequest } from "@/lib/security/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  // Constant-time and fail-closed: see isAuthorizedCronRequest (s77, s69 L4).
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { created, draft } = await createDailyDraft({
      db: createServiceRoleClient(),
      now: new Date(),
    });

    return NextResponse.json({ success: true, created, draft });
  } catch (error) {
    console.error("Error in blog draft cron job:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate blog draft" },
      { status: 500 },
    );
  }
}
