/**
 * Content Version Detail API
 * GET: Get specific version snapshot
 * POST: Restore this version to staging
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { StagingAccessManager } from "@/lib/auth/staging-access";

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
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set("Vary", "Origin");
  return response;
}

// GET: Get specific version snapshot
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);

    if (!token) {
      return withCors(
        NextResponse.json({ error: "Missing staging token" }, { status: 401 }),
        origin,
      );
    }

    const supabase = createServiceRoleClient();

    // Get the version
    const { data: version, error } = await supabase
      .from("content_versions")
      .select("*")
      .eq("id", versionId)
      .single();

    if (error || !version) {
      return withCors(
        NextResponse.json({ error: "Version not found" }, { status: 404 }),
        origin,
      );
    }

    // Validate staging access
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      version.site_id,
    );
    if (!validation.valid || !validation.verified) {
      return withCors(
        NextResponse.json(
          { error: validation.error || "Access denied" },
          { status: 401 },
        ),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        version: {
          id: version.id,
          versionNumber: version.version_number,
          snapshot: version.snapshot,
          createdBy: version.created_by,
          description: version.description,
          elementsChanged: version.elements_changed,
          changeType: version.change_type,
          createdAt: version.created_at,
        },
      }),
      origin,
    );
  } catch (error) {
    console.error("Error fetching version:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST: Restore this version to staging
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);

    if (!token) {
      return withCors(
        NextResponse.json({ error: "Missing staging token" }, { status: 401 }),
        origin,
      );
    }

    const supabase = createServiceRoleClient();

    // Get the version
    const { data: version, error: fetchError } = await supabase
      .from("content_versions")
      .select("id, site_id")
      .eq("id", versionId)
      .single();

    if (fetchError || !version) {
      return withCors(
        NextResponse.json({ error: "Version not found" }, { status: 404 }),
        origin,
      );
    }

    // Validate staging access (edit permission required)
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      version.site_id,
    );
    if (!validation.valid || !validation.verified) {
      return withCors(
        NextResponse.json(
          { error: validation.error || "Access denied" },
          { status: 401 },
        ),
        origin,
      );
    }

    const hasEditPermission =
      validation.permissions.includes("edit") ||
      validation.permissions.includes("publish") ||
      validation.permissions.includes("admin");

    if (!hasEditPermission) {
      return withCors(
        NextResponse.json(
          { error: "Edit permission required" },
          { status: 403 },
        ),
        origin,
      );
    }

    // Use the database function to restore version
    const { data, error } = await supabase.rpc("restore_content_version", {
      p_site_id: version.site_id,
      p_version_id: versionId,
      p_restored_by: validation.email || "unknown",
    });

    if (error) {
      console.error("Error restoring version:", error);
      return withCors(
        NextResponse.json(
          { error: "Failed to restore version" },
          { status: 500 },
        ),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        success: true,
        elementsRestored: data,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in version restore:", error);
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
