import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  validateAPIKey,
  rateLimiter,
  RATE_LIMIT_CONFIGS,
} from "@/lib/api/rate-limiter";
import { analytics } from "@/lib/analytics/tracker";
import { sanitizeHTML } from "@/lib/security/content-sanitizer";

/**
 * THIS IS A SERVICE-ROLE ROUTE. All four handlers below build a Supabase client
 * from `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS entirely — ADR 002
 * applies to every one of them.
 *
 * It does not call `createServiceRoleClient()`, so `grep -rn createServiceRoleClient`
 * — the census ADR 002 leans on for "which routes bypass RLS" — does not list
 * this file. That is how it came to be the one service-role path whose limiter
 * failed open (H-4): nobody counted it. The construction is deliberately left
 * alone rather than swapped, because `@supabase/ssr`'s `createServerClient` and
 * `@supabase/supabase-js`'s `createClient` differ in auth options, client
 * headers and cookie handling, and rewriting a live API route's data client is
 * not a change to make inside a security fix. This comment is the marker
 * instead: a census that greps for "SERVICE-ROLE ROUTE" or for
 * `SUPABASE_SERVICE_ROLE_KEY` finds it.
 *
 * Authorization here is `validateAPIKey` plus a strict `apiKey.site_id === siteId`
 * check in every handler — a per-key credential, not a site token, which is why
 * this route uses neither `authorizeSiteRequest` nor a per-site limiter.
 */

export async function GET(req: NextRequest) {
  try {
    // Validate API key
    const { valid, apiKey, error } = await validateAPIKey(req);
    // Narrow apiKey to non-undefined for the rest of the handler: a valid result
    // always carries the key, but the type allows undefined.
    if (!valid || !apiKey) {
      return NextResponse.json(
        { error: error || "Invalid API key" },
        { status: 401 },
      );
    }

    // Check rate limit
    const rateLimitResult = await rateLimiter.checkAPIKeyLimit(
      apiKey.id,
      RATE_LIMIT_CONFIGS.content_read,
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": rateLimitResult.total.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": Math.ceil(
              rateLimitResult.resetTime / 1000,
            ).toString(),
          },
        },
      );
    }

    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("site_id") || apiKey.site_id;
    const elementId = searchParams.get("element_id");
    const language = searchParams.get("language") || "en";
    const variant = searchParams.get("variant") || "default";

    if (!siteId) {
      return NextResponse.json(
        { error: "site_id is required" },
        { status: 400 },
      );
    }

    // Verify API key has access to site (strict: key must be bound to this site)
    if (!apiKey.site_id || apiKey.site_id !== siteId) {
      return NextResponse.json(
        { error: "API key does not have access to this site" },
        { status: 403 },
      );
    }

    // Service-role client — RLS off. See the note at the top of this file.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get: () => "",
          set: () => {},
          remove: () => {},
        },
      },
    );

    // Build query
    let query = supabase
      .from("content_elements")
      .select(
        "id, element_id, selector, published_content, original_content, language, variant, metadata, updated_at",
      )
      .eq("site_id", siteId)
      .eq("language", language)
      .eq("variant", variant);

    if (elementId) {
      query = query.eq("element_id", elementId);
    }

    const { data: contentElements, error: queryError } = await query;

    if (queryError) {
      throw queryError;
    }

    // Track API usage
    await analytics.trackAPIUsage({
      apiKeyId: apiKey.id,
      endpoint: "/api/v1/content",
      method: "GET",
      statusCode: 200,
      responseTime:
        Date.now() - parseInt(req.headers.get("x-start-time") || "0"),
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      {
        data: (contentElements || []).map((element) => ({
          ...element,
          current_content:
            element.published_content ?? element.original_content ?? "",
        })),
        meta: {
          count: contentElements?.length || 0,
          site_id: siteId,
          language,
          variant,
        },
      },
      {
        headers: {
          "X-RateLimit-Limit": rateLimitResult.total.toString(),
          "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
          "X-RateLimit-Reset": Math.ceil(
            rateLimitResult.resetTime / 1000,
          ).toString(),
        },
      },
    );
  } catch (error) {
    console.error("API v1 content GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // Validate API key
    const { valid, apiKey, error } = await validateAPIKey(req);
    // Narrow apiKey to non-undefined for the rest of the handler: a valid result
    // always carries the key, but the type allows undefined.
    if (!valid || !apiKey) {
      return NextResponse.json(
        { error: error || "Invalid API key" },
        { status: 401 },
      );
    }

    // Check permissions
    if (!apiKey.permissions?.content_write) {
      return NextResponse.json(
        { error: "API key does not have write permissions" },
        { status: 403 },
      );
    }

    // Check rate limit
    const rateLimitResult = await rateLimiter.checkAPIKeyLimit(
      apiKey.id,
      RATE_LIMIT_CONFIGS.content_write,
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": rateLimitResult.total.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": Math.ceil(
              rateLimitResult.resetTime / 1000,
            ).toString(),
          },
        },
      );
    }

    const body = await req.json();
    const { site_id, element_id, content, language, variant, metadata } = body;

    if (!site_id || !element_id || !content) {
      return NextResponse.json(
        { error: "site_id, element_id, and content are required" },
        { status: 400 },
      );
    }

    // Verify API key has access to site (strict: key must be bound to this site)
    if (!apiKey.site_id || apiKey.site_id !== site_id) {
      return NextResponse.json(
        { error: "API key does not have access to this site" },
        { status: 403 },
      );
    }

    // Service-role client — RLS off. See the note at the top of this file.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get: () => "",
          set: () => {},
          remove: () => {},
        },
      },
    );

    // Sanitize user-supplied content before any DB write
    const sanitizedContent = sanitizeHTML(content, "RICH_TEXT");

    // Check if content element exists
    const { data: existingElement } = await supabase
      .from("content_elements")
      .select("id, published_content")
      .eq("site_id", site_id)
      .eq("element_id", element_id)
      .eq("language", language || "en")
      .eq("variant", variant || "default")
      .single();

    let result;
    if (existingElement) {
      // Update existing element
      const { data, error: updateError } = await supabase
        .from("content_elements")
        .update({
          published_content: sanitizedContent,
          current_content: sanitizedContent,
          metadata: metadata || {},
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingElement.id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }
      result = data;
    } else {
      // Create new element
      const { data, error: insertError } = await supabase
        .from("content_elements")
        .insert({
          site_id,
          element_id,
          selector: `[data-element-id="${element_id}"]`, // Default selector
          original_content: sanitizedContent,
          published_content: sanitizedContent,
          current_content: sanitizedContent,
          language: language || "en",
          variant: variant || "default",
          metadata: metadata || {},
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }
      result = data;
    }

    // Track API usage
    await analytics.trackAPIUsage({
      apiKeyId: apiKey.id,
      endpoint: "/api/v1/content",
      method: "POST",
      statusCode: 200,
      responseTime:
        Date.now() - parseInt(req.headers.get("x-start-time") || "0"),
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(
      {
        data: result,
        meta: {
          operation: existingElement ? "updated" : "created",
        },
      },
      {
        status: existingElement ? 200 : 201,
        headers: {
          "X-RateLimit-Limit": rateLimitResult.total.toString(),
          "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
          "X-RateLimit-Reset": Math.ceil(
            rateLimitResult.resetTime / 1000,
          ).toString(),
        },
      },
    );
  } catch (error) {
    console.error("API v1 content POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  // Similar to POST but only updates existing content
  return POST(req);
}

export async function DELETE(req: NextRequest) {
  try {
    // Validate API key
    const { valid, apiKey, error } = await validateAPIKey(req);
    // Narrow apiKey to non-undefined for the rest of the handler: a valid result
    // always carries the key, but the type allows undefined.
    if (!valid || !apiKey) {
      return NextResponse.json(
        { error: error || "Invalid API key" },
        { status: 401 },
      );
    }

    // Check permissions
    if (!apiKey.permissions?.content_delete) {
      return NextResponse.json(
        { error: "API key does not have delete permissions" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("site_id") || apiKey.site_id;
    const elementId = searchParams.get("element_id");

    if (!siteId || !elementId) {
      return NextResponse.json(
        { error: "site_id and element_id are required" },
        { status: 400 },
      );
    }

    // Verify API key has access to site (strict: key must be bound to this site)
    if (!apiKey.site_id || apiKey.site_id !== siteId) {
      return NextResponse.json(
        { error: "API key does not have access to this site" },
        { status: 403 },
      );
    }

    // Service-role client — RLS off. See the note at the top of this file.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: {
          get: () => "",
          set: () => {},
          remove: () => {},
        },
      },
    );

    const { error: deleteError } = await supabase
      .from("content_elements")
      .delete()
      .eq("site_id", siteId)
      .eq("element_id", elementId);

    if (deleteError) {
      throw deleteError;
    }

    // Track API usage
    await analytics.trackAPIUsage({
      apiKeyId: apiKey.id,
      endpoint: "/api/v1/content",
      method: "DELETE",
      statusCode: 204,
      responseTime:
        Date.now() - parseInt(req.headers.get("x-start-time") || "0"),
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("API v1 content DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
