/**
 * Staging Content API
 * GET: Fetch staging content (requires verified staging token)
 * PUT: Update staging content (requires edit permission)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  StagingAccessManager,
  StagingPermission,
} from "@/lib/auth/staging-access";
import { sanitizeIncomingContent } from "@/lib/security/site-auth";

function extractStagingToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return request.nextUrl.searchParams.get("rcf_token");
}

function withCors(response: NextResponse, allowedOrigin: string | null) {
  const defaultOrigin = process.env.NEXT_PUBLIC_APP_URL || "*";
  const originHeader = allowedOrigin || defaultOrigin;
  response.headers.set("Access-Control-Allow-Origin", originHeader);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type",
  );
  response.headers.set("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  response.headers.set("Vary", "Origin");
  return response;
}

async function validateStagingToken(
  token: string,
  siteId: string,
  requiredPermission?: StagingPermission,
): Promise<{
  valid: boolean;
  email?: string;
  permissions?: StagingPermission[];
  error?: string;
}> {
  const result = await StagingAccessManager.validateStagingAccess(
    token,
    siteId,
  );

  if (!result.valid) {
    return { valid: false, error: result.error || "Invalid staging token" };
  }

  if (!result.verified) {
    if (result.requiresEmail) {
      return { valid: false, error: "Email required for staging access" };
    }
    if (result.requiresVerification) {
      return { valid: false, error: "Email verification required" };
    }
    return { valid: false, error: "Verification required" };
  }

  // Check permission if required
  if (requiredPermission) {
    const hasPermission =
      result.permissions.includes(requiredPermission) ||
      result.permissions.includes("admin") ||
      (requiredPermission === "edit" &&
        result.permissions.includes("publish")) ||
      (requiredPermission === "view" && result.permissions.length > 0);

    if (!hasPermission) {
      return {
        valid: false,
        error: `Requires '${requiredPermission}' permission`,
      };
    }
  }

  return {
    valid: true,
    email: result.email || undefined,
    permissions: result.permissions,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;
    const token = extractStagingToken(request);
    const origin = request.headers.get("origin");

    if (!token) {
      return withCors(
        NextResponse.json({ error: "Missing staging token" }, { status: 401 }),
        origin,
      );
    }

    // Validate staging token (view permission required)
    const validation = await validateStagingToken(token, siteId, "view");
    if (!validation.valid) {
      return withCors(
        NextResponse.json({ error: validation.error }, { status: 401 }),
        origin,
      );
    }

    const supabase = createServiceRoleClient();

    // Get language and variant from query params
    const searchParams = request.nextUrl.searchParams;
    const language = searchParams.get("language") || "en";
    const variant = searchParams.get("variant") || "default";

    // Fetch content elements with staging content
    const { data: contentElements, error } = await supabase
      .from("content_elements")
      .select(
        "id, site_id, element_id, selector, staging_content, published_content, original_content, language, variant, metadata, staging_updated_at, staging_updated_by, published_at",
      )
      .eq("site_id", siteId)
      .eq("language", language)
      .eq("variant", variant);

    if (error) {
      console.error("Error fetching staging content:", error);
      return withCors(
        NextResponse.json(
          { error: "Failed to fetch staging content" },
          { status: 500 },
        ),
        origin,
      );
    }

    // Transform content: use staging_content if available, otherwise published_content
    const transformedContent = (contentElements || []).map((element) => ({
      ...element,
      // For display, use staging_content if it exists, otherwise published_content
      current_content: element.staging_content || element.published_content,
      // Include flags for UI
      has_staging_changes:
        element.staging_content !== null &&
        element.staging_content !== element.published_content,
    }));

    return withCors(
      NextResponse.json({
        content: transformedContent,
        permissions: validation.permissions,
        email: validation.email,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in staging content fetch:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;
    const token = extractStagingToken(request);
    const origin = request.headers.get("origin");

    if (!token) {
      return withCors(
        NextResponse.json({ error: "Missing staging token" }, { status: 401 }),
        origin,
      );
    }

    // Validate staging token (edit permission required)
    const validation = await validateStagingToken(token, siteId, "edit");
    if (!validation.valid) {
      return withCors(
        NextResponse.json({ error: validation.error }, { status: 403 }),
        origin,
      );
    }

    const {
      elementId,
      content,
      language = "en",
      variant = "default",
    } = await request.json();

    if (!elementId || content === undefined) {
      return withCors(
        NextResponse.json(
          { error: "Missing elementId or content" },
          { status: 400 },
        ),
        origin,
      );
    }

    const sanitizedContent = sanitizeIncomingContent(content);
    const supabase = createServiceRoleClient();

    // Get staging access ID for history tracking
    const { data: stagingAccess } = await supabase
      .from("staging_access")
      .select("id")
      .eq("token", token)
      .single();

    // Get current element for history
    const { data: currentElement } = await supabase
      .from("content_elements")
      .select("id, staging_content")
      .eq("site_id", siteId)
      .eq("element_id", elementId)
      .eq("language", language)
      .eq("variant", variant)
      .single();

    if (!currentElement) {
      return withCors(
        NextResponse.json(
          { error: "Content element not found" },
          { status: 404 },
        ),
        origin,
      );
    }

    // Update staging content
    const { error: updateError } = await supabase
      .from("content_elements")
      .update({
        staging_content: sanitizedContent,
        staging_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("site_id", siteId)
      .eq("element_id", elementId)
      .eq("language", language)
      .eq("variant", variant);

    if (updateError) {
      console.error("Error updating staging content:", updateError);
      return withCors(
        NextResponse.json(
          { error: "Failed to update staging content" },
          { status: 500 },
        ),
        origin,
      );
    }

    // Record in staging history
    await supabase.from("staging_history").insert({
      content_element_id: currentElement.id,
      staging_access_id: stagingAccess?.id || null,
      previous_content: currentElement.staging_content,
      new_content: sanitizedContent,
      user_email: validation.email || "unknown",
      action: currentElement.staging_content ? "update" : "create",
    });

    return withCors(
      NextResponse.json({
        success: true,
        elementId,
        updatedAt: new Date().toISOString(),
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in staging content update:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return withCors(NextResponse.json({}, { status: 204 }), origin);
}
