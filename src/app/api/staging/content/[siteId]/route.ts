/**
 * Staging Content API
 * GET: Fetch staging content (requires verified staging token)
 * PUT: Update staging content (requires edit permission)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  authorizeFirstPartyEditorAccess,
  requireEditorPermission,
  validateEditorTokenFromRequest,
} from "@/lib/auth/editor-access";
import { publicOptions, withPublicCors } from "@/lib/http/public-cors";
import { sanitizeIncomingContent } from "@/lib/security/site-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;

    // Same first-party path as PUT below. Without it the owner could save a
    // draft and then be refused when reading it back, which is a worse state
    // than not being able to edit at all.
    let access = await authorizeFirstPartyEditorAccess(siteId, "view");

    if (!access) {
      const validation = await validateEditorTokenFromRequest({
        request,
        siteId,
      });
      if (!validation.valid || !validation.access) {
        return withPublicCors(
          NextResponse.json(
            { error: validation.error || "Invalid editor token" },
            { status: validation.status || 401 },
          ),
          request,
        );
      }

      if (!requireEditorPermission(validation.access, "view")) {
        return withPublicCors(
          NextResponse.json(
            { error: "Requires 'view' permission" },
            { status: 403 },
          ),
          request,
        );
      }

      access = validation.access;
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
      return withPublicCors(
        NextResponse.json(
          { error: "Failed to fetch staging content" },
          { status: 500 },
        ),
        request,
      );
    }

    // Transform content: use staging_content if available, otherwise published_content
    const transformedContent = (contentElements || []).map((element) => ({
      ...element,
      // For display, use staging_content if it exists, otherwise published_content
      current_content: element.staging_content ?? element.published_content,
      // Include flags for UI
      has_staging_changes:
        element.staging_content !== null &&
        element.staging_content !== element.published_content,
    }));

    return withPublicCors(
      NextResponse.json({
        content: transformedContent,
        permissions: access.permissions,
        email: access.email,
      }),
      request,
    );
  } catch (error) {
    console.error("Error in staging content fetch:", error);
    return withPublicCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;
    const requestBody = (await request.json()) as Record<string, unknown>;
    const elementId =
      typeof requestBody.elementId === "string" ? requestBody.elementId : "";
    const content = requestBody.content;
    const language =
      typeof requestBody.language === "string" ? requestBody.language : "en";
    const variant =
      typeof requestBody.variant === "string" ? requestBody.variant : "default";

    // The site's own owner is signed in and holds a `site_permissions` row; they
    // carry no editor token and never can, so validating tokens alone refused
    // the one caller guaranteed to hold every right. Tried first, falls through
    // to the token path untouched — see authorizeFirstPartyEditorAccess.
    const firstPartyAccess = await authorizeFirstPartyEditorAccess(
      siteId,
      "edit",
    );

    let access = firstPartyAccess;

    if (!access) {
      const validation = await validateEditorTokenFromRequest({
        request,
        siteId,
        body: requestBody,
      });
      if (!validation.valid || !validation.access) {
        return withPublicCors(
          NextResponse.json(
            { error: validation.error || "Invalid editor token" },
            { status: validation.status || 403 },
          ),
          request,
        );
      }

      if (!requireEditorPermission(validation.access, "edit")) {
        return withPublicCors(
          NextResponse.json(
            { error: "Requires 'edit' permission" },
            { status: 403 },
          ),
          request,
        );
      }

      access = validation.access;
    }

    if (!elementId || content === undefined) {
      return withPublicCors(
        NextResponse.json(
          { error: "Missing elementId or content" },
          { status: 400 },
        ),
        request,
      );
    }

    const sanitizedContent = sanitizeIncomingContent(String(content));
    const supabase = createServiceRoleClient();

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
      return withPublicCors(
        NextResponse.json(
          { error: "Content element not found" },
          { status: 404 },
        ),
        request,
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
      return withPublicCors(
        NextResponse.json(
          { error: "Failed to update staging content" },
          { status: 500 },
        ),
        request,
      );
    }

    // Record in staging history
    await supabase.from("staging_history").insert({
      content_element_id: currentElement.id,
      // Null for a first-party edit: the owner's change is not attributable to
      // any staging invite, and pointing it at one would misattribute the edit.
      staging_access_id: access.stagingAccessId || null,
      previous_content: currentElement.staging_content,
      new_content: sanitizedContent,
      user_email: access.email || access.userId || access.kind,
      action: currentElement.staging_content ? "update" : "create",
    });

    return withPublicCors(
      NextResponse.json({
        success: true,
        elementId,
        updatedAt: new Date().toISOString(),
      }),
      request,
    );
  } catch (error) {
    console.error("Error in staging content update:", error);
    return withPublicCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request, "GET,PUT,OPTIONS");
}
