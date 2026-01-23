/**
 * Staging Publish API
 * POST: Publish staging content to live
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { StagingAccessManager } from "@/lib/auth/staging-access";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const serviceClient = createServiceRoleClient();

    // Get authenticated user OR staging token
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const body = await request.json();
    const {
      siteId,
      elementIds,
      stagingToken,
    }: {
      siteId: string;
      elementIds?: string[];
      stagingToken?: string;
    } = body;

    if (!siteId) {
      return NextResponse.json({ error: "Missing siteId" }, { status: 400 });
    }

    let publisherEmail: string | null = null;
    let publisherId: string | null = null;

    // Check authorization: either authenticated user with admin/publish permission
    // OR staging token with publish permission
    if (user) {
      // Check if user has publish permission on the site
      const { data: permission, error: permError } = await supabase
        .from("site_permissions")
        .select("permission")
        .eq("site_id", siteId)
        .eq("user_id", user.id)
        .single();

      if (permError || !["admin", "owner"].includes(permission?.permission)) {
        return NextResponse.json(
          { error: "Publish permission required" },
          { status: 403 },
        );
      }

      publisherEmail = user.email || null;
      publisherId = user.id;
    } else if (stagingToken) {
      // Validate staging token with publish permission
      const validation = await StagingAccessManager.validateStagingAccess(
        stagingToken,
        siteId,
      );

      if (!validation.valid || !validation.verified) {
        return NextResponse.json(
          { error: "Invalid or unverified staging token" },
          { status: 401 },
        );
      }

      const hasPublishPermission =
        validation.permissions.includes("publish") ||
        validation.permissions.includes("admin");

      if (!hasPublishPermission) {
        return NextResponse.json(
          { error: "Publish permission required" },
          { status: 403 },
        );
      }

      publisherEmail = validation.email;
    } else {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    // Get elements to publish
    let query = serviceClient
      .from("content_elements")
      .select("id, element_id, staging_content, published_content")
      .eq("site_id", siteId)
      .not("staging_content", "is", null);

    if (elementIds && elementIds.length > 0) {
      query = query.in("element_id", elementIds);
    }

    const { data: elementsToPublish, error: fetchError } = await query;

    if (fetchError) {
      console.error("Error fetching elements to publish:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch elements" },
        { status: 500 },
      );
    }

    if (!elementsToPublish || elementsToPublish.length === 0) {
      return NextResponse.json({
        success: true,
        published: 0,
        message: "No staging changes to publish",
      });
    }

    // Filter to only elements with actual changes
    const changedElements = elementsToPublish.filter(
      (el) => el.staging_content !== el.published_content,
    );

    if (changedElements.length === 0) {
      return NextResponse.json({
        success: true,
        published: 0,
        message: "No staging changes to publish",
      });
    }

    // Publish each changed element
    const publishedAt = new Date().toISOString();
    const publishResults: { elementId: string; success: boolean }[] = [];

    for (const element of changedElements) {
      // Record in staging history before publishing
      await serviceClient.from("staging_history").insert({
        content_element_id: element.id,
        previous_content: element.published_content,
        new_content: element.staging_content,
        user_email: publisherEmail || "unknown",
        action: "publish",
      });

      // Update element: copy staging to published
      const { error: updateError } = await serviceClient
        .from("content_elements")
        .update({
          published_content: element.staging_content,
          published_at: publishedAt,
          published_by: publisherId,
          updated_at: publishedAt,
        })
        .eq("id", element.id);

      publishResults.push({
        elementId: element.element_id,
        success: !updateError,
      });

      if (updateError) {
        console.error(
          `Error publishing element ${element.element_id}:`,
          updateError,
        );
      }
    }

    const successCount = publishResults.filter((r) => r.success).length;

    return NextResponse.json({
      success: true,
      published: successCount,
      total: changedElements.length,
      results: publishResults,
      publishedAt,
      publishedBy: publisherEmail,
    });
  } catch (error) {
    console.error("Error in publish:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET: Get publishing preview - shows what would be published
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
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

    // Check if user has permission to view
    const { data: permission, error: permError } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", siteId)
      .eq("user_id", user.id)
      .single();

    if (permError || !permission) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get elements with staging changes
    const serviceClient = createServiceRoleClient();
    const { data: elementsWithChanges, error: fetchError } = await serviceClient
      .from("content_elements")
      .select(
        "id, element_id, selector, staging_content, published_content, staging_updated_at, metadata",
      )
      .eq("site_id", siteId)
      .not("staging_content", "is", null);

    if (fetchError) {
      console.error("Error fetching staging changes:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch staging changes" },
        { status: 500 },
      );
    }

    // Filter to only elements with actual changes
    const changedElements = (elementsWithChanges || [])
      .filter((el) => el.staging_content !== el.published_content)
      .map((el) => ({
        id: el.id,
        elementId: el.element_id,
        selector: el.selector,
        stagingContent: el.staging_content,
        publishedContent: el.published_content,
        stagingUpdatedAt: el.staging_updated_at,
        metadata: el.metadata,
      }));

    return NextResponse.json({
      success: true,
      pendingChanges: changedElements.length,
      elements: changedElements,
      canPublish: ["admin", "owner"].includes(permission.permission),
    });
  } catch (error) {
    console.error("Error in publish preview:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
