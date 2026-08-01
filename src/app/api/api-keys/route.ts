import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createHash, randomBytes } from "crypto";
import { validateAndSanitizeInput } from "@/lib/security/content-sanitizer";

interface ApiKeyRequest {
  siteId: string;
  name: string;
}

interface ApiKeyUpdates {
  updated_at: string;
  is_active?: boolean;
}

function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `rcp_${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const prefix = key.slice(0, 12); // "rcp_" + first 8 hex chars
  return { key, hash, prefix };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    // Insert API key into database — bound to exactly one site
    const { data: apiKey, error: insertError } = await supabase
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
      .select()
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
        ...apiKey,
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
      .select(
        `
        id,
        name,
        key_prefix,
        key_hash,
        site_id,
        scopes,
        rate_limit_per_minute,
        is_active,
        last_used_at,
        expires_at,
        created_at,
        updated_at
      `,
      )
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
    const sanitizedApiKeys = (apiKeys ?? []).map(({ key_hash, ...apiKey }) => ({
      ...apiKey,
      keyPreview: `${apiKey.key_prefix}...`,
    }));

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
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    const { data: updatedApiKey, error } = await supabase
      .from("api_keys")
      .update(updates)
      .eq("id", sanitizedApiKeyId)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      console.error("API key update error:", error);
      return NextResponse.json(
        { error: "Failed to update API key" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      apiKey: updatedApiKey,
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

    // Delete the key — ownership already confirmed above
    const { error } = await supabase
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
