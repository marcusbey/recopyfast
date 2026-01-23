/**
 * Apply Style API
 * POST: Apply a style to content elements using AI
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { aiService } from "@/lib/ai/openai-service";

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
  response.headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.headers.set("Vary", "Origin");
  return response;
}

interface TransformedContent {
  elementId: string;
  originalContent: string;
  transformedContent: string;
}

// POST: Apply style to content using AI
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
      styleId,
      elementIds,
      previewOnly = false,
    } = await request.json();

    if (!siteId || !styleId) {
      return withCors(
        NextResponse.json(
          { error: "Missing required fields: siteId, styleId" },
          { status: 400 },
        ),
        origin,
      );
    }

    // Validate staging access (edit permission required)
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

    // Get the style
    const { data: style, error: styleError } = await supabase
      .from("copy_styles")
      .select("id, name, prompt")
      .eq("id", styleId)
      .single();

    if (styleError || !style) {
      return withCors(
        NextResponse.json({ error: "Style not found" }, { status: 404 }),
        origin,
      );
    }

    // Get content elements
    let elementsQuery = supabase
      .from("content_elements")
      .select(
        "id, element_id, staging_content, published_content, element_type",
      )
      .eq("site_id", siteId);

    if (elementIds && elementIds.length > 0) {
      elementsQuery = elementsQuery.in("element_id", elementIds);
    }

    const { data: elements, error: elementsError } = await elementsQuery;

    if (elementsError || !elements || elements.length === 0) {
      return withCors(
        NextResponse.json({ error: "No elements found" }, { status: 404 }),
        origin,
      );
    }

    // Transform each element's content using AI
    const transformedContent: TransformedContent[] = [];
    let totalTokensUsed = 0;

    for (const element of elements) {
      const currentContent =
        element.staging_content || element.published_content;
      if (!currentContent || currentContent.trim().length === 0) {
        continue;
      }

      try {
        // Use AI service to transform content
        const result = await aiService.generateContentSuggestion({
          originalText: currentContent,
          context: `Element type: ${element.element_type || "text"}`,
          tone: style.name.toLowerCase(),
          goal: style.prompt,
        });

        if (result.success && result.data && result.data.length > 0) {
          // Get the first suggestion
          const suggestion = result.data[0];
          transformedContent.push({
            elementId: element.element_id,
            originalContent: currentContent,
            transformedContent:
              suggestion.text || suggestion.content || currentContent,
          });
          totalTokensUsed += result.tokensUsed || 0;
        }
      } catch (aiError) {
        console.error(
          `Error transforming element ${element.element_id}:`,
          aiError,
        );
        // Continue with other elements
      }
    }

    // If not preview only, apply the changes
    if (!previewOnly && transformedContent.length > 0) {
      // First, create a version snapshot
      await supabase.rpc("create_content_version", {
        p_site_id: siteId,
        p_created_by: validation.email || "unknown",
        p_description: `Applied "${style.name}" style`,
        p_change_type: "style_apply",
      });

      // Update staging content for each element
      for (const tc of transformedContent) {
        await supabase
          .from("content_elements")
          .update({
            staging_content: tc.transformedContent,
            staging_updated_at: new Date().toISOString(),
          })
          .eq("site_id", siteId)
          .eq("element_id", tc.elementId);
      }
    }

    return withCors(
      NextResponse.json({
        success: true,
        previewOnly,
        transformedCount: transformedContent.length,
        totalElements: elements.length,
        tokensUsed: totalTokensUsed,
        transformedContent: previewOnly ? transformedContent : undefined,
        styleName: style.name,
      }),
      origin,
    );
  } catch (error) {
    console.error("Error applying style:", error);
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
