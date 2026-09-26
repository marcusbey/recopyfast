import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { validateAPIKey } from "@/lib/api/rate-limiter";
import { enforceRateLimit, getClientIp } from "@/lib/api/rate-limit";
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
 *
 * TWO LIMITERS, both on `enforceRateLimit`, both failing closed (s44): a per-IP
 * guard before `validateAPIKey`, and a per-key bucket right after it — before
 * the scope and site checks and any `content_elements` access. Until s44 the
 * only meter was a Postgres limiter that ran AFTER authentication and queried
 * columns no schema ever had, so this route refused every request it received:
 * a freshly created key's first call was a 429 in production. Its tests passed
 * because their Supabase stub accepted any column; the route's suite now runs
 * against a double that does not (src/__tests__/api/v1/content-route.test.ts).
 */

/**
 * Pre-authentication flood guard, first on every verb.
 *
 * `validateAPIKey` is three round trips — the `api_keys` lookup, the creator's
 * `admin` row, the `last_used_at` update — and until s44 every one of them ran
 * before any limiter, so a caller cycling through made-up keys was metered by
 * nothing (AGENTS.md "Rate limit before authorization"). Per IP, because
 * nothing else is known yet; loose, because an integration may share an egress
 * address with others.
 *
 * Fails CLOSED. On a store outage the per-key limiter behind it denies every
 * valid key anyway, so failing open here would admit nothing legitimate — only
 * unauthenticated traffic to the key lookups, while nothing is metered.
 */
function shedIpFlood(request: NextRequest) {
  return enforceRateLimit(request, {
    limit: "IP_GENERAL",
    endpoint: "v1/content:ip",
    identifier: getClientIp(request),
    identifierType: "ip",
    onStoreFailure: "deny",
  });
}

/**
 * The per-key bucket, applied as soon as the key is known and before the
 * route's scope and site checks or any `content_elements` access.
 *
 * s44: this used to be the Postgres `APIRateLimiter`, which queried columns no
 * schema ever had and so refused every request — a new key's first call was a
 * 429 in production. It is now the shared Redis limiter every other route uses.
 *
 * Fails CLOSED, on every verb, reads included. AGENTS.md's "public reads fail
 * open" is the widget read (`/api/content/[siteId]` GET), where a refusal would
 * un-publish every customer's copy at once. This is not that: it is a
 * service-role read and write of one tenant's content behind a secret
 * credential, with no visitor waiting on it and a caller that can honour
 * `Retry-After`. The service-role rule governs (AGENTS.md "Data access",
 * ADR 002 §4): losing Redis must not remove the only meter in front of it.
 */
function limitApiKey(
  request: NextRequest,
  apiKey: { id: string; rate_limit_per_minute: number | null },
) {
  return enforceRateLimit(request, {
    // The window (one minute) and the fallback ceiling (100, the column's
    // default) come from the preset; the ceiling itself is the key's own
    // `rate_limit_per_minute` — the figure /dashboard/settings shows beside it.
    // One bucket per key, shared by every verb.
    limit: "API_CONTENT",
    maxRequests: apiKey.rate_limit_per_minute,
    endpoint: "v1/content",
    identifier: apiKey.id,
    identifierType: "api_key",
    onStoreFailure: "deny",
    message: "API key rate limit exceeded. Please retry after the reset.",
  });
}

export async function GET(req: NextRequest) {
  try {
    const floodLimited = await shedIpFlood(req);
    if (floodLimited) return floodLimited;

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

    const keyLimited = await limitApiKey(req, apiKey);
    if (keyLimited) return keyLimited;

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

    return NextResponse.json({
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
    });
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
    const floodLimited = await shedIpFlood(req);
    if (floodLimited) return floodLimited;

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

    const keyLimited = await limitApiKey(req, apiKey);
    if (keyLimited) return keyLimited;

    // Check permissions
    if (!apiKey.permissions?.content_write) {
      return NextResponse.json(
        { error: "API key does not have write permissions" },
        { status: 403 },
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
      { status: existingElement ? 200 : 201 },
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
    const floodLimited = await shedIpFlood(req);
    if (floodLimited) return floodLimited;

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

    const keyLimited = await limitApiKey(req, apiKey);
    if (keyLimited) return keyLimited;

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
