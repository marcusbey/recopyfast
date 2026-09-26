import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { createHash } from "crypto";

/*
 * TOMBSTONE — the Postgres rate limiter that lived here (s44).
 *
 * This module used to export `APIRateLimiter`, a limiter over the `rate_limits`
 * table, and `/api/v1/content` metered every request through it. It could never
 * have worked: it read `api_keys.rate_limit` and deleted, counted and inserted
 * `rate_limits` rows by `key` and `timestamp`, and no schema this repository
 * ever had contains any of those three columns — `rate_limits` is
 * `identifier / identifier_type / requests_count / window_start …`
 * (20250817000000_complete_database_setup.sql). PostgREST answered 42703, the
 * limiter read every error as "over the limit", and in production a freshly
 * created key's FIRST call got a 429 (2026-09-25). The endpoint had never
 * served a request. Its suite stayed green because its Supabase stub accepted
 * any column on any table.
 *
 * Do not bring a table-backed limiter back here. The route now meters through
 * `enforceRateLimit` (`@/lib/api/rate-limit`) — the Redis-backed limiter every
 * other route uses, with an explicit failure policy per call — and its tests
 * run against `src/__tests__/helpers/schema-strict-supabase.ts`, which answers
 * an unknown column the way PostgREST does. `rate_limits` is now unused by code.
 *
 * What remains is `validateAPIKey`, the API-key authentication for
 * `/api/v1/content`.
 */

/**
 * The only `api_keys` columns authentication needs, named rather than `*`.
 *
 * `*` hid the bug above: a read of a column that does not exist comes back as
 * `undefined` instead of an error, so `apiKey.rate_limit` looked like "unset"
 * for as long as it was read. A named list fails loudly on a column that is not
 * there, and keeps `key_hash` — the secret the lookup filters on — out of the
 * row this function holds.
 */
const API_KEY_AUTH_COLUMNS =
  "id, user_id, site_id, scopes, rate_limit_per_minute, expires_at";

/**
 * API key extractor and validator
 */
export async function validateAPIKey(req: NextRequest): Promise<{
  valid: boolean;
  apiKey?: {
    id: string;
    site_id: string;
    permissions: Record<string, boolean>;
    /** The key's own per-minute ceiling, as stored; `enforceRateLimit` vets it. */
    rate_limit_per_minute: number | null;
    expires_at?: string;
  };
  error?: string;
}> {
  try {
    const authHeader = req.headers.get("authorization");
    const apiKeyFromHeader = req.headers.get("x-api-key");

    let apiKeyValue: string | null = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      apiKeyValue = authHeader.substring(7);
    } else if (apiKeyFromHeader) {
      apiKeyValue = apiKeyFromHeader;
    }

    if (!apiKeyValue) {
      return { valid: false, error: "API key required" };
    }

    const keyHash = createHash("sha256").update(apiKeyValue).digest("hex");

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get: () => "",
          set: () => {},
          remove: () => {},
        },
      },
    );

    const { data: apiKey, error } = await supabase
      .from("api_keys")
      .select(API_KEY_AUTH_COLUMNS)
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .single();

    if (error || !apiKey) {
      return { valid: false, error: "Invalid API key" };
    }

    // Check if key is expired
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      return { valid: false, error: "API key expired" };
    }

    // A key speaks for its creator, so it is only as good as the creator's
    // standing on the site *now*. s42 made keys creatable for the first time,
    // and its review (M1) found the gap: this function checked only the hash
    // and is_active, so an admin who was demoted or removed kept a key with
    // content_write — and could not be stopped, because the ex-admin is refused
    // pause/delete and no other admin can see another user's key. Re-reading
    // the admin row on every call makes removal the revocation. A key with no
    // site cannot be checked at all, and a failed read fails closed; both get
    // the same answer as an unknown key.
    if (!apiKey.site_id || !apiKey.user_id) {
      console.warn(`[api-keys] refused key ${apiKey.id}: not bound to a site`);
      return { valid: false, error: "Invalid API key" };
    }

    const { data: adminRow, error: adminError } = await supabase
      .from("site_permissions")
      .select("user_id")
      .eq("user_id", apiKey.user_id)
      .eq("site_id", apiKey.site_id)
      .eq("permission", "admin")
      // No unique (site_id, user_id) index exists, so a duplicated admin row
      // must not turn maybeSingle() into an error that refuses a real admin.
      .limit(1)
      .maybeSingle();

    if (adminError || !adminRow) {
      console.warn(
        `[api-keys] refused key ${apiKey.id}: creator is not an admin of the site${adminError ? ` (${adminError.message})` : ""}`,
      );
      return { valid: false, error: "Invalid API key" };
    }

    // Update last used timestamp
    await supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", apiKey.id);

    const scopes = Array.isArray(apiKey.scopes) ? apiKey.scopes : [];

    return {
      valid: true,
      apiKey: {
        id: apiKey.id,
        site_id: apiKey.site_id,
        permissions: {
          content_read: scopes.includes("read") || scopes.includes("write"),
          content_write: scopes.includes("write"),
        },
        // Not `|| apiKey.rate_limit || 1000`: `api_keys.rate_limit` never
        // existed (see the tombstone at the top of this file).
        rate_limit_per_minute: apiKey.rate_limit_per_minute ?? null,
        expires_at: apiKey.expires_at,
      },
    };
  } catch (error) {
    console.error("API key validation error:", error);
    return { valid: false, error: "Internal error" };
  }
}
