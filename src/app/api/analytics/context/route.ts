import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { readBoundedJson } from "@/lib/api/validation";
import {
  contextConsent,
  contextCapabilityHash,
  CONTEXT_COOKIE_NAME,
  CONTEXT_MAX_AGE_SECONDS,
} from "@/lib/analytics/google-analytics/context-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

export async function POST(request: NextRequest) {
  const json = (error: string, status: number) =>
    NextResponse.json(
      { error },
      { status, headers: { "Cache-Control": "private, no-store" } },
    );
  if (
    request.headers.get("origin") !== request.nextUrl.origin ||
    (request.headers.get("sec-fetch-site") !== null &&
      request.headers.get("sec-fetch-site") !== "same-origin")
  )
    return json("Forbidden", 403);
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    return json("Expected JSON", 415);
  if (getClientIp(request) === "unknown") return json("Forbidden", 403);
  // Named ADR070 public service write: fail closed before auth/body parsing.
  const limited = await enforceRateLimit(request, {
    limit: "API_GENERAL",
    endpoint: "analytics/context",
    onStoreFailure: "deny",
    maxRequests: 30,
  });
  if (limited) return limited;
  const body = await readBoundedJson(request, 256);
  if (
    !body.ok ||
    !body.value ||
    typeof body.value !== "object" ||
    Array.isArray(body.value)
  )
    return json("Invalid request", 400);
  const value = body.value as Record<string, unknown>;
  if (
    typeof value.action !== "string" ||
    !["capture", "revoke", "signout"].includes(value.action) ||
    Object.keys(value).some((k) => !["action", "clientId"].includes(k))
  )
    return json("Invalid request", 400);
  if (
    value.action === "capture" &&
    (typeof value.clientId !== "string" ||
      !/^[0-9]{1,32}\.[0-9]{1,32}$/.test(value.clientId))
  )
    return json("Invalid request", 400);
  if (value.action !== "capture" && "clientId" in value)
    return json("Invalid request", 400);
  const response = new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "private, no-store" },
  });
  const oldHash = contextCapabilityHash(request);
  try {
    const client = createServiceRoleClient();
    if (value.action !== "capture") {
      // A capability alone can erase its captures. getUser additionally permits
      // an account-wide denial; sign-out erases only this browser's capability.
      let userId: string | null = null;
      let hasAuthFailure = false;
      if (value.action === "revoke") {
        try {
          const auth = await createClient();
          const { data, error } = await auth.auth.getUser();
          if (!error) userId = data.user?.id ?? null;
          else hasAuthFailure = !isAuthSessionMissingError(error);
        } catch {
          hasAuthFailure = true;
        }
      }
      const { error } = await client.rpc("revoke_analytics_context", {
        p_hash: oldHash,
        p_user_id: userId,
      });
      if (error) throw new Error("revoke");
      // A transient auth outage cannot silently downgrade an account-wide
      // withdrawal to this one browser. Erase its capability now, but retain
      // the cookie/pending action so a later verified retry reaches all devices.
      if (hasAuthFailure) {
        console.warn(
          "[analytics/context] authenticated withdrawal unavailable",
        );
        return json("Analytics unavailable", 503);
      }
      response.cookies.set(CONTEXT_COOKIE_NAME, "", {
        ...cookieOptions,
        maxAge: 0,
      });
      return response;
    }
    if (process.env.ANALYTICS_CONTEXT_DISABLED === "1") return response;
    const consent = contextConsent(request);
    if (!consent) return response;
    const capability = oldHash ? null : randomBytes(32).toString("base64url");
    const hash =
      oldHash ?? createHash("sha256").update(capability!).digest("hex");
    const { data, error } = await client.rpc("capture_analytics_context", {
      p_hash: hash,
      p_client_id: value.clientId,
      p_basis: consent.basis,
      p_consent_expires_at: new Date(consent.expiresAt).toISOString(),
      p_existing: oldHash !== null,
    });
    if (error) throw new Error("capture");
    if (!data) {
      response.cookies.set(CONTEXT_COOKIE_NAME, "", {
        ...cookieOptions,
        maxAge: 0,
      });
      return response;
    }
    if (capability)
      response.cookies.set(CONTEXT_COOKIE_NAME, capability, {
        ...cookieOptions,
        maxAge: Math.min(
          CONTEXT_MAX_AGE_SECONDS,
          Math.floor((consent.expiresAt - Date.now()) / 1000),
        ),
      });
    return response;
  } catch {
    console.warn("[analytics/context] operation unavailable");
    return json("Analytics unavailable", 503);
  }
}
