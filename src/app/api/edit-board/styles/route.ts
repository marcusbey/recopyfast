/**
 * Copy Styles API
 * GET: List all styles (presets + custom for site)
 * POST: Create custom style
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { readStagingDeviceFingerprint } from "@/lib/auth/staging-device";

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

// GET: List all styles (presets + custom for site)
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

    const supabase = createServiceRoleClient();

    // Get preset styles (site_id is NULL)
    const { data: presets, error: presetError } = await supabase
      .from("copy_styles")
      .select("id, name, description, prompt, is_preset, created_at")
      .eq("is_preset", true)
      .order("name");

    if (presetError) {
      console.error("Error fetching presets:", presetError);
    }

    // Get custom styles for this site
    const { data: customStyles, error: customError } = await supabase
      .from("copy_styles")
      .select("id, name, description, prompt, is_preset, created_at")
      .eq("site_id", siteId)
      .order("name");

    if (customError) {
      console.error("Error fetching custom styles:", customError);
    }

    return withCors(
      NextResponse.json({
        presets: presets || [],
        custom: customStyles || [],
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in styles list:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST: Create custom style
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

    const { siteId, name, description, prompt } = await request.json();

    if (!siteId || !name || !prompt) {
      return withCors(
        NextResponse.json(
          { error: "Missing required fields: siteId, name, prompt" },
          { status: 400 },
        ),
        origin,
      );
    }

    // Validate staging access (admin permission required)
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

    const { data: style, error } = await supabase
      .from("copy_styles")
      .insert({
        site_id: siteId,
        name,
        description: description || null,
        prompt,
        is_preset: false,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating style:", error);
      return withCors(
        NextResponse.json({ error: "Failed to create style" }, { status: 500 }),
        origin,
      );
    }

    return withCors(
      NextResponse.json({
        success: true,
        style,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error in style create:", error);
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
