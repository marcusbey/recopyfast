/**
 * Content Version Detail API
 * GET: Get specific version snapshot
 * POST: Restore this version to staging
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { readStagingDeviceFingerprint } from "@/lib/auth/staging-device";
import {
  authorizeFirstPartyEditorAccess,
  requireEditorPermission,
} from "@/lib/auth/editor-access";
import { withPublicCors } from "@/lib/http/public-cors";

function extractStagingToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return request.nextUrl.searchParams.get("rcf_token");
}

/**
 * Is this caller carrying anything at all that could authorise them?
 *
 * The site a version belongs to is only knowable by reading the version row, so
 * the lookup genuinely has to precede the permission check. That ordering made
 * the endpoint answer differently for a version id that exists (401, after the
 * row was found) and one that does not (404) — an existence oracle for anyone,
 * signed in or not, since the old short-circuit on a missing staging token no
 * longer came first.
 *
 * Restoring that short-circuit without losing the owner's first-party path
 * means asking the one question that needs no site: does this request carry a
 * credential of either kind? A caller with neither cannot be authorised for any
 * version, so they learn nothing from being refused before the lookup.
 */
async function hasAnyCredential(token: string | null): Promise<boolean> {
  if (token) return true;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return Boolean(user);
}

function unauthenticated(origin: string | null) {
  return withCors(
    NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    origin,
  );
}

function withCors(response: NextResponse, origin?: string | null) {
  return withPublicCors(response, origin, "GET,POST,OPTIONS");
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
    const supabase = createServiceRoleClient();

    if (!(await hasAnyCredential(token))) {
      return unauthenticated(origin);
    }

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

    // The signed-in owner holds `site_permissions` and never a staging token.
    // Same first-party path as the history list and the staging routes.
    const firstPartyAccess = await authorizeFirstPartyEditorAccess(
      version.site_id,
      "view",
    );

    if (!firstPartyAccess) {
      if (!token) {
        return withCors(
          NextResponse.json(
            { error: "Missing staging token" },
            { status: 401 },
          ),
          origin,
        );
      }

      // Validate staging access
      const validation = await StagingAccessManager.validateStagingAccess(
        token,
        version.site_id,
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
    const supabase = createServiceRoleClient();

    if (!(await hasAnyCredential(token))) {
      return unauthenticated(origin);
    }

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

    const firstPartyAccess = await authorizeFirstPartyEditorAccess(
      version.site_id,
      "view",
    );

    // Who to record on the restore, whichever way they authenticated.
    let restoredBy: string | null = null;

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

      restoredBy = firstPartyAccess.email ?? null;
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
        version.site_id,
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

      restoredBy = validation.email ?? null;
    }

    // Two arguments, not three.
    //
    // This passed `p_site_id` as well, and no database has ever had a
    // `restore_content_version` that accepts it: production's takes
    // (p_version_id, p_restored_by) and derives the site from the version row
    // itself. PostgREST resolves RPC by NAMED arguments, so the extra one made
    // every call fail resolution with PGRST202 — rollback returned 500 for
    // everybody, always. It went unnoticed because the route was reachable only
    // with a staging token, and the register never got that far.
    //
    // The repo's own migration (20251230100000_edit_board.sql) declares the
    // three-argument shape, so the schema and production disagreed exactly the
    // way they did for `billing_customers` in F-1 — a fresh database would have
    // behaved differently from the live one. 20260804150000 reconciles it.
    const { data, error } = await supabase.rpc("restore_content_version", {
      p_version_id: versionId,
      p_restored_by: restoredBy || "unknown",
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
  return withCors(new NextResponse(null, { status: 204 }), origin);
}
