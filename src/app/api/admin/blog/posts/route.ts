/**
 * GET /api/admin/blog/posts?status=draft|published — what a platform admin
 * reviews before publishing (s89, ADR 057; runbook docs/operations/blog.md).
 *
 * Drafts by default, newest first, each with its full markdown `content` so it
 * can be read before it goes live. There was no way to see a draft at all
 * before s89: the cron published directly.
 *
 * Read through the service role, after `authorizePlatformAdmin` (per-IP flood
 * guard → getUser() → per-user limiter → ADMIN_EMAILS or `app_metadata.role`,
 * both limiters fail closed): RLS hides drafts from an owner who is admin only
 * through ADMIN_EMAILS. A read, so no Origin check — no CORS header is ever
 * set, so another origin cannot read the answer — but `no-store`, because it
 * holds unpublished copy.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdmin } from "@/lib/auth/platform-admin";
import { BLOG_POST_SUMMARY_COLUMNS } from "@/lib/blog/drafts";
import { createServiceRoleClient } from "@/lib/supabase/service";

const LISTABLE_STATUSES = ["draft", "published"] as const;
const REVIEW_COLUMNS = `${BLOG_POST_SUMMARY_COLUMNS}, content`;
const MAX_LISTED_POSTS = 50;
const NO_STORE = { "Cache-Control": "no-store" } as const;

type ListableStatus = (typeof LISTABLE_STATUSES)[number];

function isListableStatus(value: string): value is ListableStatus {
  return (LISTABLE_STATUSES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const admin = await authorizePlatformAdmin(request, {
    endpoint: "admin-blog:read",
    userLimit: "USER_GENERAL",
  });
  if (!admin.ok) return admin.response;

  const status = request.nextUrl.searchParams.get("status") ?? "draft";
  if (!isListableStatus(status)) {
    return NextResponse.json(
      { error: `"status" must be one of: ${LISTABLE_STATUSES.join(", ")}` },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const { data, error } = await createServiceRoleClient()
      .from("blog_posts")
      .select(REVIEW_COLUMNS)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(MAX_LISTED_POSTS);

    if (error) throw new Error(error.message);

    return NextResponse.json({ posts: data ?? [] }, { headers: NO_STORE });
  } catch (error) {
    console.error("[admin-blog] listing posts failed", error);
    return NextResponse.json(
      { error: "Failed to list blog posts" },
      { status: 500, headers: NO_STORE },
    );
  }
}
