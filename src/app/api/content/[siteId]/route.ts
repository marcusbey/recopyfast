import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  authorizeFirstPartySiteRequest,
  authorizeSiteRequest,
  authorizeSiteOrigin,
} from "@/lib/security/site-auth";
import { validateDiscoveredText } from "@/lib/security/discovered-text";
import { enforceRateLimit } from "@/lib/api/rate-limit";

interface ContentMapData {
  selector: string;
  content: string;
  type: string;
}

interface ContentElementRow {
  site_id: string;
  element_id: string;
  selector: string;
  original_content: string;
  current_content: string;
  published_content: string;
  language: string;
  variant: string;
  metadata: { type: string };
}

type DiscoveryRows =
  | { ok: true; rows: ContentElementRow[] }
  | { ok: false; error: string };

/**
 * Turn a reported content map into rows, or refuse the whole map.
 *
 * The customer's text is stored exactly as the widget read it off their page.
 * It is not markup and no consumer treats it as markup, so it is not sanitized
 * as markup — see `@/lib/security/discovered-text` for why that mattered and
 * what is checked instead (A-1). A map is all-or-nothing: writing the elements
 * that happened to validate and dropping the rest is the silent partial failure
 * this route was already guilty of, one layer up.
 */
function buildDiscoveryRows(
  siteId: string,
  contentMap: Record<string, ContentMapData>,
): DiscoveryRows {
  const rows: ContentElementRow[] = [];

  for (const [elementId, data] of Object.entries(contentMap)) {
    const validated = validateDiscoveredText(data?.content);
    if (!validated.ok) {
      return { ok: false, error: `Element ${elementId}: ${validated.error}` };
    }

    rows.push({
      site_id: siteId,
      element_id: elementId,
      selector: data.selector,
      original_content: validated.value,
      current_content: validated.value,
      published_content: validated.value,
      language: "en",
      variant: "default",
      metadata: { type: data.type },
    });
  }

  return { ok: true, rows };
}

function extractToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  const token = request.nextUrl.searchParams.get("token");
  return token;
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
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  response.headers.set("Vary", "Origin");
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;
    const supabase = createServiceRoleClient();

    let allowedOrigin: string | null = null;

    // Dashboard requests are same-origin with a Supabase session and never
    // carry a site token, so try that path first; only fall back to the
    // widget's token/origin path when there is no session (or no permission
    // row), keeping the widget's behavior byte-for-byte unchanged.
    const firstPartyAuth = await authorizeFirstPartySiteRequest(siteId);

    if (firstPartyAuth) {
      allowedOrigin = firstPartyAuth.allowedOrigin;
    } else {
      const token = extractToken(request);
      const origin = request.headers.get("origin");
      const referer = request.headers.get("referer");

      try {
        ({ allowedOrigin } = await authorizeSiteRequest({
          siteId,
          token: token,
          origin,
          referer,
        }));
      } catch (authError) {
        console.error("Content GET authorization failed:", authError);
        return NextResponse.json(
          {
            error:
              authError instanceof Error ? authError.message : "Unauthorized",
          },
          {
            status:
              authError instanceof Error &&
              authError.message === "Origin not allowed"
                ? 403
                : 401,
          },
        );
      }
    }

    // Bucketed by IP, not by site: this is the read every visitor to the
    // customer's page makes, so a per-site counter would throttle popular sites
    // first and hardest. Fails OPEN — the widget's only fallback is to leave the
    // authored markup in place (recopyfast.src.js:3293), so a Redis outage that
    // denied here would un-publish every customer's copy at once. An
    // unmetered window on a read is the cheaper failure.
    const limited = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "content/read",
      identifierType: "ip",
      onStoreFailure: "allow",
      message: "Too many content requests. Please try again shortly.",
    });
    if (limited) return withCors(limited, allowedOrigin);

    // Get language and variant from query params
    const searchParams = request.nextUrl.searchParams;
    const language = searchParams.get("language") || "en";
    const variant = searchParams.get("variant") || "default";

    // Fetch content elements - use published_content for live sites
    const { data: contentElements, error } = await supabase
      .from("content_elements")
      .select(
        "id, site_id, element_id, selector, published_content, original_content, language, variant, metadata, published_at",
      )
      .eq("site_id", siteId)
      .eq("language", language)
      .eq("variant", variant);

    if (error) {
      console.error("Error fetching content:", error);
      return NextResponse.json(
        { error: "Failed to fetch content" },
        { status: 500 },
      );
    }

    // Transform: use published_content as current_content for backward compatibility
    // Fall back to original_content if published_content is null (for existing data)
    const transformedContent = (contentElements || []).map((element) => ({
      ...element,
      current_content:
        element.published_content ?? element.original_content ?? "",
    }));

    return withCors(NextResponse.json(transformedContent), allowedOrigin);
  } catch (error) {
    console.error("Error in content fetch:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;
    const contentMap = await request.json();
    const supabase = createServiceRoleClient();
    const token = extractToken(request);
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");

    let allowedOrigin: string | null = null;

    try {
      ({ allowedOrigin } = await authorizeSiteRequest({
        siteId,
        token: token,
        origin,
        referer,
      }));
    } catch (authError) {
      console.error("Content POST authorization failed:", authError);
      return NextResponse.json(
        {
          error:
            authError instanceof Error ? authError.message : "Unauthorized",
        },
        {
          status:
            authError instanceof Error &&
            authError.message === "Origin not allowed"
              ? 403
              : 401,
        },
      );
    }

    // Bucketed by site, and fails CLOSED. This is the one path that writes
    // content_elements with the service-role key, and the credential that opens
    // it is published in the customer's own page markup — so the limit is what
    // bounds the damage a copied token can do, and losing Redis must not remove
    // it. Discovery is a one-time event per element (the widget reports only ids
    // the server does not already hold), so a legitimate site never approaches
    // this, and a refused report is retried by the next visitor's scan.
    const limited = await enforceRateLimit(request, {
      limit: "API_CONTENT",
      endpoint: "content/discovery",
      identifier: siteId,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "Content discovery rate limit exceeded for this site.",
    });
    if (limited) return withCors(limited, allowedOrigin);

    // Verify site exists
    const { data: site } = await supabase
      .from("sites")
      .select("id")
      .eq("id", siteId)
      .single();

    if (!site) {
      return withCors(
        NextResponse.json({ error: "Site not found" }, { status: 404 }),
        allowedOrigin,
      );
    }

    const discovered = buildDiscoveryRows(
      siteId,
      contentMap as Record<string, ContentMapData>,
    );

    if (!discovered.ok) {
      return withCors(
        NextResponse.json({ error: discovered.error }, { status: 400 }),
        allowedOrigin,
      );
    }

    // Insert newly discovered elements only. Existing rows may already carry
    // published edits, so content discovery must not overwrite published_content.
    const { error } = await supabase
      .from("content_elements")
      .upsert(discovered.rows, {
        onConflict: "site_id,element_id,language,variant",
        ignoreDuplicates: true,
      });

    if (error) {
      console.error("Error upserting content:", error);
      return withCors(
        NextResponse.json({ error: "Failed to save content" }, { status: 500 }),
        allowedOrigin,
      );
    }

    return withCors(NextResponse.json({ success: true }), allowedOrigin);
  } catch (error) {
    console.error("Error in content save:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;
    const token = extractToken(request);
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");

    let allowedOrigin: string | null = null;

    try {
      ({ allowedOrigin } = await authorizeSiteRequest({
        siteId,
        token: token,
        origin,
        referer,
      }));
    } catch (authError) {
      console.error("Content PUT authorization failed:", authError);
      return NextResponse.json(
        {
          error:
            authError instanceof Error ? authError.message : "Unauthorized",
        },
        {
          status:
            authError instanceof Error &&
            authError.message === "Origin not allowed"
              ? 403
              : 401,
        },
      );
    }

    return withCors(
      NextResponse.json(
        {
          error:
            "Live content updates must use /api/staging/content and publish explicitly",
        },
        { status: 403 },
      ),
      allowedOrigin,
    );
  } catch (error) {
    console.error("Error in content update:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function OPTIONS(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;
    const { allowedOrigin } = await authorizeSiteOrigin(
      siteId,
      request.headers.get("origin"),
      request.headers.get("referer"),
    );

    // `new NextResponse(null, …)`, not `NextResponse.json({}, …)`. 204 means
    // No Content and the Response constructor rejects a body with it, so the
    // json form threw on every single call — the handler never reached its
    // return and answered 403 unconditionally, from the catch below.
    //
    // The preflight for this route has therefore never succeeded. Since the
    // widget's content fetch is cross-origin and carries headers that force a
    // preflight, the browser blocked it before it was ever sent: published
    // copy could not reach a visitor on any real customer site. That is the
    // defect 47e414e set out to fix, still live, because the fixture that
    // verified it did not cross an origin.
    return withCors(
      new NextResponse(null, { status: 204 }),
      allowedOrigin ?? null,
    );
  } catch (error) {
    // The client still gets an undifferentiated 403 — telling an unknown caller
    // whether a site id exists is exactly what this check is for. But the
    // server must not lose the reason: `authorizeSiteOrigin` throws both
    // "Origin not allowed" and "Site not found", and a database failure throws
    // something else again. Collapsing all three into one silent 403 meant a
    // blocked preflight was indistinguishable from a missing row, and the
    // visitor content fetch that depends on this preflight simply never
    // happened, with nothing anywhere saying why.
    console.error(
      `[content] preflight refused for site ${await params
        .then((p) => p.siteId)
        .catch(() => "unknown")}:`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }
}
