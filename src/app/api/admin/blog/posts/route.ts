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
const MAX_CURSOR_LENGTH = 256;
const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTGRES_TIMESTAMPTZ =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/;

type ListableStatus = (typeof LISTABLE_STATUSES)[number];

function isListableStatus(value: string): value is ListableStatus {
  return (LISTABLE_STATUSES as readonly string[]).includes(value);
}

interface PostCursor {
  createdAt: string | null;
  id: string;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidPostgresTimestamptz(value: string): boolean {
  const match = value.match(POSTGRES_TIMESTAMPTZ);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 14 &&
    offsetMinute <= 59 &&
    (offsetHour < 14 || offsetMinute === 0)
  );
}

function decodeCursor(value: string): PostCursor | null {
  if (
    value.length === 0 ||
    value.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(",") !== "createdAt,id" ||
      (parsed.createdAt !== null &&
        (typeof parsed.createdAt !== "string" ||
          !isValidPostgresTimestamptz(parsed.createdAt))) ||
      typeof parsed.id !== "string" ||
      !UUID.test(parsed.id)
    ) {
      return null;
    }
    return { createdAt: parsed.createdAt, id: parsed.id.toLowerCase() };
  } catch {
    return null;
  }
}

function encodeCursor(cursor: PostCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function cursorFilter(cursor: PostCursor): string {
  if (cursor.createdAt === null) {
    return `and(created_at.is.null,id.lt.${cursor.id})`;
  }
  return [
    `created_at.lt.${cursor.createdAt}`,
    `and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    "created_at.is.null",
  ].join(",");
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

  const cursorValue = request.nextUrl.searchParams.get("cursor");
  const cursor = cursorValue === null ? null : decodeCursor(cursorValue);
  if (cursorValue !== null && !cursor) {
    return NextResponse.json(
      { error: 'Invalid "cursor"' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    let query = createServiceRoleClient()
      .from("blog_posts")
      .select(REVIEW_COLUMNS)
      .eq("status", status)
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(MAX_LISTED_POSTS + 1);

    // The cursor is decoded into a strict ISO timestamp/null plus UUID before
    // entering PostgREST's raw `or` grammar. The 51st row is fetched only as a
    // continuation signal; every response remains capped at 50 review drafts.
    if (cursor) query = query.or(cursorFilter(cursor));

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{
      id: string;
      created_at: string | null;
    }>;
    const posts = rows.slice(0, MAX_LISTED_POSTS);
    const last = posts.at(-1);
    const nextCursor =
      rows.length > MAX_LISTED_POSTS && last
        ? encodeCursor({
            // Preserve Postgres' original microseconds and offset. JS Date
            // truncates to milliseconds; canonicalizing here can move the
            // boundary backward and skip an adjacent row on the next page.
            createdAt: last.created_at,
            id: last.id,
          })
        : null;

    return NextResponse.json({ posts, nextCursor }, { headers: NO_STORE });
  } catch (error) {
    console.error("[admin-blog] listing posts failed", error);
    return NextResponse.json(
      { error: "Failed to list blog posts" },
      { status: 500, headers: NO_STORE },
    );
  }
}
