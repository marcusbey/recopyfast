/**
 * Site Themes API
 * GET: List all themes for a site
 * POST: Create a new theme
 * PUT: Update a theme (activate, schedule, modify overrides)
 * DELETE: Remove a theme
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
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,OPTIONS",
  );
  response.headers.set("Vary", "Origin");
  return response;
}

// GET: List all themes for a site
export async function GET(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);
    const siteId = request.nextUrl.searchParams.get("siteId");

    if (!token || !siteId) {
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

    const supabase = createServiceRoleClient();

    const { data: themes, error } = await supabase
      .from("site_themes")
      .select(
        "id, name, description, content_overrides, style_overrides, is_active, schedule_start, schedule_end, created_at",
      )
      .eq("site_id", siteId)
      .order("is_active", { ascending: false })
      .order("name");

    if (error) {
      console.error("Error fetching themes:", error);
      return withCors(
        NextResponse.json({ error: "Failed to fetch themes" }, { status: 500 }),
        origin,
      );
    }

    // Check for scheduled themes that should be active
    const now = new Date().toISOString();
    const themesWithScheduleStatus = (themes || []).map((theme) => ({
      ...theme,
      isScheduledActive:
        theme.schedule_start &&
        theme.schedule_end &&
        theme.schedule_start <= now &&
        theme.schedule_end >= now,
      overrideCount: Object.keys(theme.content_overrides || {}).length,
    }));

    return withCors(
      NextResponse.json({
        themes: themesWithScheduleStatus,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in themes list:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST: Create a new theme
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);

    if (!token) {
      return withCors(
        NextResponse.json({ error: "Missing staging token" }, { status: 401 }),
        origin,
      );
    }

    const {
      siteId,
      name,
      description,
      contentOverrides,
      styleOverrides,
      scheduleStart,
      scheduleEnd,
    } = await request.json();

    if (!siteId || !name) {
      return withCors(
        NextResponse.json(
          { error: "Missing required fields: siteId, name" },
          { status: 400 },
        ),
        origin,
      );
    }

    // Validate staging access (admin permission required)
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
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

    if (!validation.permissions.includes("admin")) {
      return withCors(
        NextResponse.json(
          { error: "Admin permission required" },
          { status: 403 },
        ),
        origin,
      );
    }

    const supabase = createServiceRoleClient();

    const { data: theme, error } = await supabase
      .from("site_themes")
      .insert({
        site_id: siteId,
        name,
        description: description || null,
        content_overrides: contentOverrides || {},
        style_overrides: styleOverrides || {},
        is_active: false,
        schedule_start: scheduleStart || null,
        schedule_end: scheduleEnd || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating theme:", error);
      return withCors(
        NextResponse.json({ error: "Failed to create theme" }, { status: 500 }),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        success: true,
        theme,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in theme create:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT: Update a theme
export async function PUT(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);

    if (!token) {
      return withCors(
        NextResponse.json({ error: "Missing staging token" }, { status: 401 }),
        origin,
      );
    }

    const {
      siteId,
      themeId,
      name,
      description,
      contentOverrides,
      styleOverrides,
      isActive,
      scheduleStart,
      scheduleEnd,
    } = await request.json();

    if (!siteId || !themeId) {
      return withCors(
        NextResponse.json(
          { error: "Missing required fields: siteId, themeId" },
          { status: 400 },
        ),
        origin,
      );
    }

    // Validate staging access (edit permission for content, admin for activation)
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
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

    // Activation requires admin
    if (isActive !== undefined && !validation.permissions.includes("admin")) {
      return withCors(
        NextResponse.json(
          { error: "Admin permission required to activate themes" },
          { status: 403 },
        ),
        origin,
      );
    }

    if (!hasEditPermission) {
      return withCors(
        NextResponse.json(
          { error: "Edit permission required" },
          { status: 403 },
        ),
        origin,
      );
    }

    const supabase = createServiceRoleClient();

    // If activating a theme, deactivate all others first
    if (isActive === true) {
      await supabase
        .from("site_themes")
        .update({ is_active: false })
        .eq("site_id", siteId)
        .neq("id", themeId);
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (contentOverrides !== undefined)
      updateData.content_overrides = contentOverrides;
    if (styleOverrides !== undefined)
      updateData.style_overrides = styleOverrides;
    if (isActive !== undefined) updateData.is_active = isActive;
    if (scheduleStart !== undefined) updateData.schedule_start = scheduleStart;
    if (scheduleEnd !== undefined) updateData.schedule_end = scheduleEnd;

    const { data: theme, error } = await supabase
      .from("site_themes")
      .update(updateData)
      .eq("id", themeId)
      .eq("site_id", siteId)
      .select()
      .single();

    if (error) {
      console.error("Error updating theme:", error);
      return withCors(
        NextResponse.json({ error: "Failed to update theme" }, { status: 500 }),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        success: true,
        theme,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in theme update:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE: Remove a theme
export async function DELETE(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    const token = extractStagingToken(request);
    const siteId = request.nextUrl.searchParams.get("siteId");
    const themeId = request.nextUrl.searchParams.get("themeId");

    if (!token || !siteId || !themeId) {
      return withCors(
        NextResponse.json(
          { error: "Missing required parameters" },
          { status: 400 },
        ),
        origin,
      );
    }

    // Validate staging access (admin permission required)
    const validation = await StagingAccessManager.validateStagingAccess(
      token,
      siteId,
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

    if (!validation.permissions.includes("admin")) {
      return withCors(
        NextResponse.json(
          { error: "Admin permission required" },
          { status: 403 },
        ),
        origin,
      );
    }

    const supabase = createServiceRoleClient();

    // Check if theme is active
    const { data: theme } = await supabase
      .from("site_themes")
      .select("is_active")
      .eq("id", themeId)
      .single();

    if (theme?.is_active) {
      return withCors(
        NextResponse.json(
          { error: "Cannot delete an active theme. Deactivate it first." },
          { status: 400 },
        ),
        origin,
      );
    }

    const { error } = await supabase
      .from("site_themes")
      .delete()
      .eq("id", themeId)
      .eq("site_id", siteId);

    if (error) {
      console.error("Error deleting theme:", error);
      return withCors(
        NextResponse.json({ error: "Failed to delete theme" }, { status: 500 }),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        success: true,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in theme delete:", error);
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
