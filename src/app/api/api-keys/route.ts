import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createHash, randomBytes } from "crypto";
import { validateAndSanitizeInput } from "@/lib/security/content-sanitizer";
import {
  enforceRateLimit,
  getClientIp,
  type RateLimitFailureMode,
} from "@/lib/api/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service";

/*
 * Write boundary (s42).
 *
 * Every create, pause and delete from /dashboard/settings failed in
 * production. `api_keys` has one user policy, FOR SELECT
 * (20260804130000_restore_missing_rls_policies.sql), and s38
 * (20260925120000_sites_api_key_column_grants.sql) revoked every web-role
 * INSERT/UPDATE/DELETE privilege on top of it. This route kept writing through
 * the user-scoped client, so RLS refused each statement with 42501 — while the
 * unit suite, which mocked Supabase as permissive, stayed green.
 *
 * The table is service-write by design, like `sites` and `webhooks`: the
 * signed-in user may read their own rows, and only the server writes. So:
 *
 *   1. authentication and every authorization read (the `admin` row in
 *      `site_permissions`, the key-ownership read) stay on the user-scoped
 *      client, under RLS;
 *   2. only the single write statement uses the service role, and the client is
 *      created after those checks pass, never before;
 *   3. an update or delete is filtered by `id` AND the session `user_id`, and an
 *      insert takes `user_id` from the session, so the RLS-bypassing statement
 *      can only ever touch the caller's own key.
 *
 * Do not "fix" a future failure here by adding an authenticated write policy.
 * A direct PostgREST insert would let any browser session choose its own
 * `key_hash` (a weak or known key), bypass the generator and the limiter below,
 * and reach `scopes` / `rate_limit_per_minute`, which govern /api/v1/content
 * (`validateAPIKey` in src/lib/api/rate-limiter.ts). ADR 034 removed those
 * privileges deliberately, and src/__tests__/db/column-privileges.test.ts pins
 * that they stay removed.
 */

interface ApiKeyRequest {
  siteId: string;
  name: string;
}

interface ApiKeyUpdates {
  updated_at: string;
  is_active?: boolean;
}

/**
 * Safe columns returned by create and update operations.
 *
 * `key_hash` is intentionally absent. The database now denies authenticated
 * callers access to that column, so Supabase's default mutation projection
 * (`.select()` with no arguments) would ask PostgREST for the hidden hash and
 * turn an otherwise successful write into "permission denied for column
 * key_hash". Keep this list explicit: a new database column must not silently
 * become part of the API response.
 */
const API_KEY_RESPONSE_COLUMNS = [
  "id",
  "user_id",
  "site_id",
  "name",
  "key_prefix",
  "scopes",
  "rate_limit_per_minute",
  "is_active",
  "last_used_at",
  "expires_at",
  "created_at",
  "updated_at",
].join(", ");

/** GET keeps its existing public shape, which never included `user_id`. */
const API_KEY_LIST_COLUMNS = [
  "id",
  "name",
  "key_prefix",
  "site_id",
  "scopes",
  "rate_limit_per_minute",
  "is_active",
  "last_used_at",
  "expires_at",
  "created_at",
  "updated_at",
].join(", ");

/** Defence in depth if a mock or future data layer returns more than requested. */
function withoutKeyHash(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};

  const publicValue = { ...(value as Record<string, unknown>) };
  delete publicValue.key_hash;
  return publicValue;
}

/**
 * Pre-authentication flood guard, shared by every verb.
 *
 * It runs before `getUser()`, because authentication and the
 * `site_permissions` lookup behind it are exactly the work a flood is trying
 * to cause — a limiter placed after them never sees the requests it exists to
 * stop. It is keyed on IP and deliberately loose: agencies and offices share
 * one NAT address, so the tight bucket belongs to the account (see
 * `limitKeyWrites`). Each verb states its own store-failure policy.
 */
function shedIpFlood(
  request: NextRequest,
  onStoreFailure: RateLimitFailureMode,
) {
  return enforceRateLimit(request, {
    limit: "IP_GENERAL",
    endpoint: "api-keys:ip",
    identifier: getClientIp(request),
    onStoreFailure,
  });
}

/**
 * Per-account bucket for create / pause / delete, applied once the caller is
 * known and before any authorization lookup.
 *
 * Fails CLOSED. These writes run with RLS bypassed (see
 * `createServiceRoleClient` below) and each one mints or revokes a credential
 * for the public `/api/v1/content` API, so losing Redis must not remove the
 * only meter in front of them (ADR 002 §4). Ten changes a minute is far above
 * anything a person managing keys by hand will reach.
 */
function limitKeyWrites(request: NextRequest, userId: string) {
  return enforceRateLimit(request, {
    limit: "API_UPLOAD",
    endpoint: "api-keys:write",
    identifier: userId,
    identifierType: "user",
    onStoreFailure: "deny",
    message: "Too many API key changes. Please try again shortly.",
  });
}

function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `rcp_${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 12); // "rcp_" + first 8 hex chars
  return { key, hash, prefix };
}

export async function POST(request: NextRequest) {
  try {
    // Fails CLOSED: this verb writes a credential with RLS bypassed.
    const floodLimited = await shedIpFlood(request, "deny");
    if (floodLimited) return floodLimited;

    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const writeLimited = await limitKeyWrites(request, user.id);
    if (writeLimited) return writeLimited;

    const body: ApiKeyRequest = await request.json();
    const { siteId, name } = body;

    // Validate and sanitize inputs
    const sanitizedSiteId = validateAndSanitizeInput(siteId);
    const sanitizedName = validateAndSanitizeInput(name);

    if (!sanitizedSiteId || !sanitizedName) {
      return NextResponse.json(
        { error: "Missing required fields: siteId and name are required" },
        { status: 400 },
      );
    }

    // Verify the authenticated user has admin permission on this site
    const { data: sitePermission, error: permissionError } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", sanitizedSiteId)
      .eq("user_id", user.id)
      .single();

    if (
      permissionError ||
      !sitePermission ||
      sitePermission.permission !== "admin"
    ) {
      return NextResponse.json(
        {
          error: "Insufficient permissions — admin role required for this site",
        },
        { status: 403 },
      );
    }

    // Generate API key
    const { key, hash, prefix } = generateApiKey();

    // Service-role insert — see "Write boundary" at the top of this file.
    // Bound to exactly one site: `user_id` is the session user and `site_id` is
    // the site whose admin row was just read under RLS. Key material, scopes and
    // rate limit are never taken from the request body.
    const serviceClient = createServiceRoleClient();
    const { data: apiKey, error: insertError } = await serviceClient
      .from("api_keys")
      .insert([
        {
          user_id: user.id,
          site_id: sanitizedSiteId,
          name: sanitizedName,
          key_hash: hash,
          key_prefix: prefix,
          is_active: true,
        },
      ])
      .select(API_KEY_RESPONSE_COLUMNS)
      .single();

    if (insertError) {
      console.error("API key creation error:", insertError);
      return NextResponse.json(
        { error: "Failed to create API key" },
        { status: 500 },
      );
    }

    // Return the API key (only show the actual key on creation)
    return NextResponse.json({
      apiKey: {
        ...withoutKeyHash(apiKey),
        key, // Only returned on creation — store it securely
      },
      warning: "Store this API key securely. It will not be shown again.",
    });
  } catch (error) {
    console.error("API key creation API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Fails OPEN: listing is a user-scoped read under RLS that returns only
    // the caller's own rows, never touches the service role, and is re-run by
    // the settings panel on every site switch and after every write. A Redis
    // blip must not turn "your keys" into an error state.
    const floodLimited = await shedIpFlood(request, "allow");
    if (floodLimited) return floodLimited;

    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");

    if (!siteId) {
      return NextResponse.json(
        { error: "Missing siteId parameter" },
        { status: 400 },
      );
    }

    const sanitizedSiteId = validateAndSanitizeInput(siteId);

    // Verify the caller has at least some permission on the site before listing keys
    const { data: sitePermission, error: permissionError } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", sanitizedSiteId)
      .eq("user_id", user.id)
      .single();

    if (permissionError || !sitePermission) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // Fetch all API keys scoped to this site that belong to the caller
    const { data: apiKeys, error } = await supabase
      .from("api_keys")
      .select(API_KEY_LIST_COLUMNS)
      .eq("site_id", sanitizedSiteId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("API keys fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch API keys" },
        { status: 500 },
      );
    }

    // Don't return the full hash — expose only the prefix and a masked indicator
    const sanitizedApiKeys = (apiKeys ?? []).map((apiKey) => {
      const publicApiKey = withoutKeyHash(apiKey);
      return {
        ...publicApiKey,
        keyPreview: `${publicApiKey.key_prefix}...`,
      };
    });

    return NextResponse.json({ apiKeys: sanitizedApiKeys });
  } catch (error) {
    console.error("API keys fetch API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Fails CLOSED: this verb writes a credential with RLS bypassed.
    const floodLimited = await shedIpFlood(request, "deny");
    if (floodLimited) return floodLimited;

    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const writeLimited = await limitKeyWrites(request, user.id);
    if (writeLimited) return writeLimited;

    const body: { apiKeyId: string; isActive?: boolean } = await request.json();
    const { apiKeyId, isActive } = body;

    const sanitizedApiKeyId = validateAndSanitizeInput(apiKeyId);
    if (!sanitizedApiKeyId) {
      return NextResponse.json(
        { error: "Missing API key ID" },
        { status: 400 },
      );
    }

    // Fetch the key first to get its site_id, confirming ownership
    const { data: existingKey, error: fetchError } = await supabase
      .from("api_keys")
      .select("id, site_id")
      .eq("id", sanitizedApiKeyId)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !existingKey) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    // Confirm the caller has admin permission on the key's site
    const { data: sitePermission, error: permissionError } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", existingKey.site_id)
      .eq("user_id", user.id)
      .single();

    if (
      permissionError ||
      !sitePermission ||
      sitePermission.permission !== "admin"
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // Build update object — only allowed fields, no `any`
    const updates: ApiKeyUpdates = { updated_at: new Date().toISOString() };
    if (typeof isActive === "boolean") updates.is_active = isActive;

    // Service-role update — see "Write boundary" at the top of this file.
    // Both filters are load-bearing: RLS no longer scopes this statement, so
    // `user_id` is what keeps it on the key whose ownership was read above.
    const serviceClient = createServiceRoleClient();
    const { data: updatedApiKey, error } = await serviceClient
      .from("api_keys")
      .update(updates)
      .eq("id", sanitizedApiKeyId)
      .eq("user_id", user.id)
      .select(API_KEY_RESPONSE_COLUMNS)
      .single();

    if (error) {
      console.error("API key update error:", error);
      return NextResponse.json(
        { error: "Failed to update API key" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      apiKey: withoutKeyHash(updatedApiKey),
      message: "API key updated successfully",
    });
  } catch (error) {
    console.error("API key update API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Fails CLOSED: this verb writes a credential with RLS bypassed.
    const floodLimited = await shedIpFlood(request, "deny");
    if (floodLimited) return floodLimited;

    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const writeLimited = await limitKeyWrites(request, user.id);
    if (writeLimited) return writeLimited;

    const { searchParams } = new URL(request.url);
    const apiKeyId = searchParams.get("apiKeyId");

    if (!apiKeyId) {
      return NextResponse.json(
        { error: "Missing apiKeyId parameter" },
        { status: 400 },
      );
    }

    const sanitizedApiKeyId = validateAndSanitizeInput(apiKeyId);

    // Fetch the key first to get its site_id, confirming ownership
    const { data: existingKey, error: fetchError } = await supabase
      .from("api_keys")
      .select("id, site_id")
      .eq("id", sanitizedApiKeyId)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !existingKey) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    // Confirm the caller has admin permission on the key's site
    const { data: sitePermission, error: permissionError } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", existingKey.site_id)
      .eq("user_id", user.id)
      .single();

    if (
      permissionError ||
      !sitePermission ||
      sitePermission.permission !== "admin"
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // Service-role delete — see "Write boundary" at the top of this file.
    // Ownership was read above under RLS; RLS does not scope this statement, so
    // `user_id` stays in the filter and it can only remove the caller's own key.
    const serviceClient = createServiceRoleClient();
    const { error } = await serviceClient
      .from("api_keys")
      .delete()
      .eq("id", sanitizedApiKeyId)
      .eq("user_id", user.id);

    if (error) {
      console.error("API key deletion error:", error);
      return NextResponse.json(
        { error: "Failed to delete API key" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "API key deleted successfully",
    });
  } catch (error) {
    console.error("API key deletion API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
