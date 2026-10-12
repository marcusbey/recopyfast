/**
 * /api/blog/generate
 *
 *   GET  — a random topic suggestion (public, reads nothing).
 *   POST — an on-demand AI DRAFT, for a platform admin only.
 *
 * Until s89, POST accepted the cron bearer or an admin session and inserted
 * the model's post with `status: "published"` — no person between OpenAI and
 * the public page, against the PRD's "it drafts, a human publishes"
 * (docs/prd.md:320-322). It wrote through the cookie-bound RLS client, which
 * refuses the cron (no session: `anon`) and an owner who is admin only through
 * ADMIN_EMAILS (the write policy reads `app_metadata.role`, which cannot see an
 * env var) — research facts 2 and 3.
 *
 * Now, in this order (ADR 057):
 *   1. same-origin POST — the session cookie is SameSite=Lax, and branded
 *      `*.recopyfa.st` hosts are same-site (ADR 021);
 *   2. `authorizePlatformAdmin`: per-IP flood guard → getUser() → per-user
 *      limiter (tight: each call is an OpenAI spend) → ADMIN_EMAILS or
 *      `app_metadata.role`; both limiters fail closed;
 *   3. a bounded, validated body — read field by field, never spread;
 *   4. only then the service-role client, writing a draft through
 *      `createOnDemandDraft`, which cannot write anything but a draft.
 *
 * The cron bearer opens nothing here any more: the daily cron drafts
 * in-process (src/app/api/cron/generate-blog-post/route.ts), and a leaked
 * CRON_SECRET must not buy an OpenAI-spending POST. Publishing is
 * POST /api/admin/blog/posts/[id] (docs/operations/blog.md).
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdmin } from "@/lib/auth/platform-admin";
import { createOnDemandDraft } from "@/lib/blog/drafts";
import { pickTopic, type BlogTopic } from "@/lib/blog/topics";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import {
  optionalPlainText,
  readBoundedJson,
  type ValidationResult,
} from "@/lib/api/validation";
import { createServiceRoleClient } from "@/lib/supabase/service";

const MAX_BODY_BYTES = 4 * 1024;
const MAX_TOPIC_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 50;
const MAX_KEYWORDS_LENGTH = 500;

export async function GET() {
  try {
    return NextResponse.json({ suggestion: pickTopic() });
  } catch (error) {
    console.error("Error suggesting blog topic:", error);
    return NextResponse.json(
      { error: "Failed to suggest topic" },
      { status: 500 },
    );
  }
}

interface GenerateBody {
  subject?: BlogTopic;
  keywords?: string;
}

function invalid(error: string): ValidationResult<GenerateBody> {
  return { ok: false, error };
}

/** `topic` and `category` travel together; `targetKeywords` is optional. */
function parseBody(raw: unknown): ValidationResult<GenerateBody> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("Request body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;

  const topic = optionalPlainText(body, "topic", {
    maxLength: MAX_TOPIC_LENGTH,
  });
  if (!topic.ok) return invalid(topic.error);
  const category = optionalPlainText(body, "category", {
    maxLength: MAX_CATEGORY_LENGTH,
  });
  if (!category.ok) return invalid(category.error);
  const keywords = optionalPlainText(body, "targetKeywords", {
    maxLength: MAX_KEYWORDS_LENGTH,
  });
  if (!keywords.ok) return invalid(keywords.error);

  if (Boolean(topic.value) !== Boolean(category.value)) {
    return invalid('Fields "topic" and "category" must be given together');
  }

  return {
    ok: true,
    value: {
      subject:
        topic.value && category.value
          ? { topic: topic.value, category: category.value }
          : undefined,
      keywords: keywords.value,
    },
  };
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = await authorizePlatformAdmin(request, {
    endpoint: "blog-generate",
    userLimit: "API_UPLOAD",
  });
  if (!admin.ok) return admin.response;

  const raw = await readBoundedJson(request, MAX_BODY_BYTES);
  if (!raw.ok) {
    return NextResponse.json({ error: raw.error }, { status: 400 });
  }
  const body = parseBody(raw.value);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }

  try {
    const draft = await createOnDemandDraft({
      db: createServiceRoleClient(),
      now: new Date(),
      subject: body.value.subject,
      keywords: body.value.keywords,
    });
    return NextResponse.json({ success: true, draft });
  } catch (error) {
    console.error("Error generating blog draft:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate blog draft" },
      { status: 500 },
    );
  }
}
