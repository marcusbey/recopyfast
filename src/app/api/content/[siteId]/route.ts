import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  authorizeFirstPartySiteRequest,
  authorizeSiteRequest,
  authorizeSiteOrigin,
} from "@/lib/security/site-auth";
import {
  redactControlCharacters,
  validateDiscoveredElement,
  validateElementId,
} from "@/lib/security/discovered-text";
import { enforceRateLimit } from "@/lib/api/rate-limit";

interface ContentElementRow {
  site_id: string;
  element_id: string;
  selector: string;
  original_content: string;
  current_content: string;
  published_content: string;
  language: string;
  variant: string;
  metadata: { type?: string };
}

/** One element that could not be stored, and why. */
interface SkippedElement {
  elementId: string;
  reason: string;
}

/**
 * How many skips a response will list.
 *
 * A page has tens of elements; a caller sending junk can name thousands, and
 * echoing every reason back turns a refusal into an amplifier. The count is
 * always exact even when the list is cut.
 */
const MAX_REPORTED_SKIPS = 50;

/** Longest element id a report will echo, for the same reason. */
const MAX_ECHOED_ID_LENGTH = 64;

type DiscoveryRows =
  | { ok: true; rows: ContentElementRow[]; skipped: SkippedElement[] }
  | { ok: false; error: string };

/**
 * Make a rejected element id safe to repeat back.
 *
 * Redaction comes first, then the cut. `validateElementId` refuses an id carrying
 * control characters — but this excerpt appears in that very refusal, in the
 * response body and in a `console.warn`, so an id containing CR/LF would forge a
 * log line on its way to being rejected for containing CR/LF.
 */
function idExcerpt(elementId: string): string {
  const safe = redactControlCharacters(elementId);

  return safe.length > MAX_ECHOED_ID_LENGTH
    ? `${safe.slice(0, MAX_ECHOED_ID_LENGTH)}...`
    : safe;
}

/**
 * Turn a reported content map into rows, skipping the entries that cannot be
 * stored and naming them.
 *
 * The customer's text is stored exactly as the widget read it off their page.
 * It is not markup and no consumer treats it as markup, so it is not sanitized
 * as markup — see `@/lib/security/discovered-text` for why that mattered, and for
 * what every field is checked against instead (A-1). Nothing reaches the
 * service-role upsert unvalidated, including the element id, which is part of the
 * upsert's conflict key.
 *
 * WHY ONE BAD ELEMENT DOES NOT SINK THE MAP. The widget reports an `<img>` by its
 * `src` (recopyfast.src.js:2362) and only skips images under 48px (:2400-2404), so
 * a visible inline `data:` URI arrives as one enormous "text" value. Refusing the
 * whole map for it meant a single base64 image blocked every heading and paragraph
 * on that page from ever being discovered — permanently, because the widget claims
 * its report before sending and only releases the claim on a network error, so
 * every later visitor re-sent the same map and got the same refusal. That is worse
 * than the truncation this fix replaced: truncation at least landed the rest.
 *
 * Cap-exempting such a value would be worse again: content is copied into
 * `original_content`, `current_content` AND `published_content`, and then served to
 * every visitor on every page load, so a 100 KB data URI is 300 KB of row and 100 KB
 * on the wire, forever. The element is skipped instead — it is simply not editable —
 * and the skip is reported rather than swallowed, which is the whole point of the
 * audit this fix belongs to.
 *
 * A malformed map is still refused whole: null, an array or a scalar is not a
 * partially-valid content map, it is a caller that is not the widget.
 */
function buildDiscoveryRows(
  siteId: string,
  contentMap: unknown,
): DiscoveryRows {
  // `Object.entries(null)` throws, and the outer catch would turn a malformed
  // body into a 500 — an answer that reads as "our fault" for a request that was
  // never well-formed. An array passes `typeof === "object"` and would index its
  // members as element ids, so it is refused by name.
  if (
    typeof contentMap !== "object" ||
    contentMap === null ||
    Array.isArray(contentMap)
  ) {
    return { ok: false, error: "Content map must be an object" };
  }

  const rows: ContentElementRow[] = [];
  const skipped: SkippedElement[] = [];

  for (const [elementId, data] of Object.entries(contentMap)) {
    const id = validateElementId(elementId);
    if (!id.ok) {
      skipped.push({ elementId: idExcerpt(elementId), reason: id.error });
      continue;
    }

    const element = validateDiscoveredElement(data);
    if (!element.ok) {
      skipped.push({ elementId: id.value, reason: element.error });
      continue;
    }

    rows.push({
      site_id: siteId,
      element_id: id.value,
      selector: element.value.selector,
      original_content: element.value.content,
      current_content: element.value.content,
      published_content: element.value.content,
      language: "en",
      variant: "default",
      metadata: element.value.type ? { type: element.value.type } : {},
    });
  }

  return { ok: true, rows, skipped };
}

/**
 * The answer to a discovery report.
 *
 * `{ success: true }` when everything landed — the shape this route has always
 * returned, so nothing that reads it has to learn a new one for the ordinary case.
 * Skips are additive, and counted separately from the list because the list is
 * capped.
 */
function discoveryResult(skipped: SkippedElement[]) {
  if (skipped.length === 0) {
    return { success: true };
  }

  return {
    success: true,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, MAX_REPORTED_SKIPS),
  };
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

/**
 * Shed load before spending anything on deciding who the caller is.
 *
 * Every method here does database work before it can know whether the request is
 * authorized at all: the `sites` lookup inside `authorizeSiteRequest` and
 * `authorizeSiteOrigin`, plus a Supabase session check on GET. Metering only
 * after that left those round trips unbounded for a caller holding no credential
 * — the flood never reached the limiter, because the limiter was behind the work
 * it was supposed to protect.
 *
 * PER IP, NEVER PER SITE. Bucketing this by site id would let an unauthenticated
 * flood spend a customer's discovery budget and lock their real widget out — a
 * worse denial of service than the one it closes. A per-IP bucket can only
 * exhaust itself.
 *
 * FAILS OPEN, unlike the per-site limiter on POST. This sits in front of every
 * legitimate widget request too, so a Redis outage must not stop content reaching
 * visitors on every customer site at once. POST keeps its fail-closed per-site
 * limiter behind this one, so the service-role write stays bounded even in the
 * window where this is unmetered — which is why the two coexist rather than one
 * replacing the other.
 *
 * The refusal is deliberately not CORS-wrapped: nothing is known about the site
 * yet, so there is no origin this route would be willing to echo. A browser
 * therefore cannot read the 429 body — it lands in the widget's `.catch`, the same
 * place any blocked fetch does, and the page keeps its authored copy.
 */
function shedUnauthenticatedLoad(request: NextRequest, endpoint: string) {
  return enforceRateLimit(request, {
    limit: "IP_GENERAL",
    endpoint,
    identifierType: "ip",
    onStoreFailure: "allow",
    message: "Too many content requests. Please try again shortly.",
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const shed = await shedUnauthenticatedLoad(request, "content/read");
    if (shed) return shed;

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
    const shed = await shedUnauthenticatedLoad(request, "content/discovery-ip");
    if (shed) return shed;

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

    // The second limiter, behind authorization: bucketed by site, and fails
    // CLOSED. This is the one path that writes content_elements with the
    // service-role key, and the credential that opens it is published in the
    // customer's own page markup — so this is what bounds the damage a copied
    // token can do, and losing Redis must not remove it. The per-IP limiter in
    // front sheds anonymous floods; this one caps what an authenticated caller can
    // write, and neither substitutes for the other. Discovery is a one-time event
    // per element (the widget reports only ids the server does not already hold),
    // so a legitimate site never approaches this, and a refused report is retried
    // by the next visitor's scan.
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

    const discovered = buildDiscoveryRows(siteId, contentMap);

    if (!discovered.ok) {
      return withCors(
        NextResponse.json({ error: discovered.error }, { status: 400 }),
        allowedOrigin,
      );
    }

    if (discovered.skipped.length > 0) {
      // The widget sends this report fire-and-forget and never reads the body
      // (recopyfast.src.js:2924-2950), so the log is where a skipped element is
      // visible to us. Bounded for the same reason the response list is.
      console.warn(
        `[content] site ${siteId}: skipped ${discovered.skipped.length} element(s) during discovery:`,
        discovered.skipped
          .slice(0, MAX_REPORTED_SKIPS)
          .map((skip) => `${skip.elementId} (${skip.reason})`)
          .join("; "),
      );
    }

    // Insert newly discovered elements only. Existing rows may already carry
    // published edits, so content discovery must not overwrite published_content.
    //
    // Guarded on there being something to write: a map whose every entry was
    // skipped is not a reason to spend a service-role round trip on an empty
    // upsert.
    if (discovered.rows.length > 0) {
      const { error } = await supabase
        .from("content_elements")
        .upsert(discovered.rows, {
          onConflict: "site_id,element_id,language,variant",
          ignoreDuplicates: true,
        });

      if (error) {
        console.error("Error upserting content:", error);
        return withCors(
          NextResponse.json(
            { error: "Failed to save content" },
            { status: 500 },
          ),
          allowedOrigin,
        );
      }
    }

    return withCors(
      NextResponse.json(discoveryResult(discovered.skipped)),
      allowedOrigin,
    );
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
    // Metered too, even though every authorized answer here is a 403: the refusal
    // sits behind the same `sites` lookup as the other methods, so leaving this
    // method alone would just move an anonymous flood one verb to the left.
    const shed = await shedUnauthenticatedLoad(request, "content/update");
    if (shed) return shed;

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
  // A preflight is not an authorization decision, so it does not get to be an
  // information channel either. The status is now the same for every caller;
  // only the grant differs.
  //
  // It used to answer 403 whenever `authorizeSiteOrigin` threw — and that throws
  // both "Origin not allowed" AND "Site not found". Uniformly refusing hid the
  // difference, but once a localhost origin was admitted on dev builds, 204
  // versus 403 told any page on a developer's machine whether a given site id
  // existed. Nothing about a preflight needs the answer to vary.
  //
  // Withholding the *grant* is what actually stops a wrong origin, and it always
  // was: a 204 whose `Access-Control-Allow-Origin` is not the caller's own is a
  // preflight the browser refuses to act on, so the GET or POST behind it is
  // never sent. Same outcome the 403 produced, minus the oracle. And admitting
  // one grants nothing on its own — a preflight carries no content, and the real
  // request still has to pass the whole token-and-origin check.
  // Metered like the rest: `authorizeSiteOrigin` does a `sites` lookup, so an
  // unlimited preflight is an unlimited query, and a preflight is the one request
  // on this route a caller can make with no credential of any kind. A 429 here
  // does not reintroduce the oracle the uniform 204 closed — it depends on the
  // caller's own request rate, not on whether the site id exists.
  const shed = await shedUnauthenticatedLoad(request, "content/preflight");
  if (shed) return shed;

  let siteId = "unknown";
  let allowedOrigin: string | null = null;

  try {
    ({ siteId } = await params);
    const granted = await authorizeSiteOrigin(
      siteId,
      request.headers.get("origin"),
      request.headers.get("referer"),
    );
    allowedOrigin = granted.allowedOrigin ?? null;
  } catch (error) {
    // The answer no longer carries the reason, so the log has to. "Origin not
    // allowed", "Site not found" and a database failure are three very different
    // things to be looking at when a customer's widget has gone quiet.
    console.error(
      `[content] preflight not granted for site ${siteId}:`,
      error instanceof Error ? error.message : error,
    );
  }

  // `new NextResponse(null, …)`, not `NextResponse.json({}, …)`. 204 means No
  // Content and the Response constructor rejects a body with it, so the json form
  // threw on every single call — the handler never reached its return and answered
  // 403 from the catch instead.
  //
  // The preflight for this route therefore never succeeded. Since the widget's
  // content fetch is cross-origin and carries headers that force a preflight, the
  // browser blocked it before it was ever sent: published copy could not reach a
  // visitor on any real customer site. That is the defect 47e414e set out to fix,
  // still live, because the fixture that verified it did not cross an origin.
  return withCors(new NextResponse(null, { status: 204 }), allowedOrigin);
}
