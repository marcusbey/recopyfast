/**
 * Platform admin — the person who runs RecopyFast, not a site's admin (s89,
 * ADR 057).
 *
 * Two sources, both server-managed:
 *   1. the ADMIN_EMAILS env allow-list (comma-separated, case-insensitive) —
 *      how the owner is made admin in Vercel;
 *   2. `app_metadata.role === "admin"`, set only through the Supabase Admin SDK.
 * Never `user_metadata`: any signed-in user can write it (PATCH
 * /api/auth/profile, `auth.updateUser`), so reading a role from it is a
 * privilege escalation.
 *
 * ADMIN_EMAILS is invisible to RLS, so a route this guard admits does its
 * `blog_posts` work through the service role (ADR 057). That is why the order
 * below is fixed and both limiters fail closed:
 *   per-IP flood guard → getUser() → per-user limiter → admin check.
 * The IP guard runs before authentication because authentication itself (a
 * GoTrue round trip) is the work a flood is trying to cause. Callers that
 * change state check the Origin first (`isSameOriginRequest`).
 *
 * The audit routes (graveyard, docs/prd.md:141-142) keep their own copies of
 * the allow-list check; this helper is the blog's.
 */

import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import type { RATE_LIMIT_CONFIGS } from "@/lib/security/rate-limiter";
import { createClient } from "@/lib/supabase/server";

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(
  user: Pick<User, "email" | "app_metadata">,
): boolean {
  if (user.email && adminEmails().includes(user.email.toLowerCase())) {
    return true;
  }
  return user.app_metadata?.role === "admin";
}

export type PlatformAdminCheck =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export interface PlatformAdminOptions {
  /** Scopes both limiter buckets, e.g. "admin-blog:write". */
  endpoint: string;
  /** The signed-in user's bucket. */
  userLimit: keyof typeof RATE_LIMIT_CONFIGS;
}

async function signedInUser(): Promise<User | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    return error ? null : user;
  } catch (error) {
    // Cannot confirm who this is: deny, and say why in the logs.
    console.error("[platform-admin] session lookup failed", error);
    return null;
  }
}

export async function authorizePlatformAdmin(
  request: NextRequest,
  { endpoint, userLimit }: PlatformAdminOptions,
): Promise<PlatformAdminCheck> {
  const ipLimited = await enforceRateLimit(request, {
    limit: "IP_GENERAL",
    endpoint: `${endpoint}:ip`,
    identifier: getClientIp(request),
    onStoreFailure: "deny",
  });
  if (ipLimited) return { ok: false, response: ipLimited };

  const user = await signedInUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const userLimited = await enforceRateLimit(request, {
    limit: userLimit,
    endpoint: `${endpoint}:user`,
    identifier: user.id,
    identifierType: "user",
    onStoreFailure: "deny",
  });
  if (userLimited) return { ok: false, response: userLimited };

  if (!isPlatformAdmin(user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, userId: user.id };
}
