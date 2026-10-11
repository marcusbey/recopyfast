/**
 * POST /api/admin/blog/posts/[id]  { "action": "publish" | "unpublish" }
 *
 * The only way a blog post goes live (s89, ADR 057; runbook
 * docs/operations/blog.md). Until s89 the daily cron inserted AI posts as
 * `published` with nobody reviewing them; now every AI post is a draft and a
 * platform admin publishes it here, after reading it.
 *
 *   publish   — draft → published, `published_at` = now
 *   unpublish — published → draft, `published_at` = NULL (fix it, republish)
 *
 * Order (ADR 057):
 *   1. same-origin — the session cookie is SameSite=Lax and every branded
 *      `*.recopyfa.st` host is same-site (ADR 021); absent Origin refused;
 *   2. `authorizePlatformAdmin`: per-IP flood guard → getUser() → per-user
 *      limiter → ADMIN_EMAILS or `app_metadata.role` (never user_metadata);
 *      both limiters fail closed;
 *   3. a validated id (UUID, canonical case) and action;
 *   4. only then the service role, one conditional UPDATE scoped by that id
 *      AND the status the action expects — a transition, never a blind write,
 *      so a double click or a stale tab gets 409 instead of re-stamping the
 *      date.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdmin } from "@/lib/auth/platform-admin";
import {
  BLOG_POST_SUMMARY_COLUMNS,
  type BlogPostStatus,
} from "@/lib/blog/drafts";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import {
  readBoundedJson,
  requireEnum,
  requireUuid,
} from "@/lib/api/validation";
import { createServiceRoleClient } from "@/lib/supabase/service";

const MAX_BODY_BYTES = 1024;
const ACTIONS = ["publish", "unpublish"] as const;

type Action = (typeof ACTIONS)[number];

interface Transition {
  from: BlogPostStatus;
  patch: (now: Date) => { status: BlogPostStatus; published_at: string | null };
}

const TRANSITIONS: Record<Action, Transition> = {
  publish: {
    from: "draft",
    patch: (now) => ({ status: "published", published_at: now.toISOString() }),
  },
  unpublish: {
    from: "published",
    patch: () => ({ status: "draft", published_at: null }),
  },
};

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = await authorizePlatformAdmin(request, {
    endpoint: "admin-blog:write",
    userLimit: "API_UPLOAD",
  });
  if (!admin.ok) return admin.response;

  const id = requireUuid({ id: (await params).id }, "id");
  if (!id.ok) return badRequest(id.error);

  const raw = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!raw.ok) return badRequest(raw.error);
  if (raw.value === null || typeof raw.value !== "object") {
    return badRequest("Request body must be a JSON object");
  }
  const action = requireEnum(
    raw.value as Record<string, unknown>,
    "action",
    ACTIONS,
  );
  if (!action.ok) return badRequest(action.error);

  const transition = TRANSITIONS[action.value];

  try {
    const db = createServiceRoleClient();
    const { data: post, error } = await db
      .from("blog_posts")
      .update(transition.patch(new Date()))
      .eq("id", id.value)
      .eq("status", transition.from)
      .select(BLOG_POST_SUMMARY_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (post) {
      // The audit trail of who put what on the public site.
      console.info(
        `[admin-blog] ${action.value} post ${id.value} by user ${admin.userId}`,
      );
      return NextResponse.json({ post });
    }

    const { data: current, error: readError } = await db
      .from("blog_posts")
      .select("id, status")
      .eq("id", id.value)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    if (!current) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Post is ${current.status}, not ${transition.from}` },
      { status: 409 },
    );
  } catch (error) {
    console.error(`[admin-blog] ${action.value} failed`, error);
    return NextResponse.json(
      { error: "Failed to update the blog post" },
      { status: 500 },
    );
  }
}
