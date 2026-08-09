/**
 * Content Versions (History) API
 * GET: List all versions for a site
 * POST: Create a new version snapshot
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { readStagingDeviceFingerprint } from "@/lib/auth/staging-device";
import {
  authorizeFirstPartyEditorAccess,
  requireEditorPermission,
} from "@/lib/auth/editor-access";

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

// GET: List all versions for a site
export async function GET(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);
    const siteId = request.nextUrl.searchParams.get("siteId");

    if (!siteId) {
      return withCors(
        NextResponse.json({ error: "Missing siteId" }, { status: 400 }),
        origin,
      );
    }

    // The site's own owner is signed in and holds a `site_permissions` row;
    // they carry no staging token and never can. Version history was the third
    // route in this codebase to model only the invited editor and lock out the
    // one caller guaranteed to hold every right — see the F-4 and N-1 fixes.
    const firstPartyAccess = await authorizeFirstPartyEditorAccess(
      siteId,
      "view",
    );

    if (!firstPartyAccess) {
      if (!token) {
        return withCors(
          NextResponse.json(
            { error: "Missing staging token or siteId" },
            { status: 401 },
          ),
          origin,
        );
      }

      // Validate staging access
      const validation = await StagingAccessManager.validateStagingAccess(
        token,
        siteId,
        readStagingDeviceFingerprint(request),
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
    }

    const supabase = createServiceRoleClient();
    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");
    const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0");

    // Fetch versions ordered by version_number descending
    const { data: versions, error } = await supabase
      .from("content_versions")
      .select(
        "id, version_number, created_by, description, elements_changed, change_type, created_at",
      )
      .eq("site_id", siteId)
      .order("version_number", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Error fetching versions:", error);
      return withCors(
        NextResponse.json(
          { error: "Failed to fetch versions" },
          { status: 500 },
        ),
        origin,
      );
    }

    // Get total count
    const { count } = await supabase
      .from("content_versions")
      .select("*", { count: "exact", head: true })
      .eq("site_id", siteId);

    return withCors(
      NextResponse.json({
        versions: versions || [],
        total: count || 0,
        hasMore: (count || 0) > offset + limit,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in history list:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST: Create a new version snapshot
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);

    const { siteId, description, changeType = "manual" } = await request.json();

    if (!siteId) {
      return withCors(
        NextResponse.json({ error: "Missing siteId" }, { status: 400 }),
        origin,
      );
    }

    // Signed-in owner first; falls through to the staging token untouched.
    const firstPartyAccess = await authorizeFirstPartyEditorAccess(
      siteId,
      "view",
    );

    let authorEmail: string | null = null;

    if (firstPartyAccess) {
      if (!requireEditorPermission(firstPartyAccess, "edit")) {
        return withCors(
          NextResponse.json(
            { error: "Edit permission required" },
            { status: 403 },
          ),
          origin,
        );
      }
      authorEmail = firstPartyAccess.email ?? null;
    } else {
      if (!token) {
        return withCors(
          NextResponse.json(
            { error: "Missing staging token" },
            { status: 401 },
          ),
          origin,
        );
      }

      // Validate staging access (edit permission required)
      const validation = await StagingAccessManager.validateStagingAccess(
        token,
        siteId,
        readStagingDeviceFingerprint(request),
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

      authorEmail = validation.email ?? null;
    }

    const supabase = createServiceRoleClient();

    // Use the database function to create version
    const { data, error } = await supabase.rpc("create_content_version", {
      p_site_id: siteId,
      p_created_by: authorEmail || "unknown",
      p_description: description || null,
      p_change_type: changeType,
    });

    if (error) {
      console.error("Error creating version:", error);
      return withCors(
        NextResponse.json(
          { error: "Failed to create version" },
          { status: 500 },
        ),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        success: true,
        versionId: data,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in version create:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return withCors(new NextResponse(null, { status: 204 }), origin);
}
