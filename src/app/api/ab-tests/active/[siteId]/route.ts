import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { authorizeSiteRequest } from "@/lib/security/site-auth";
import { enforceRateLimit } from "@/lib/api/rate-limit";

function extractToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return request.nextUrl.searchParams.get("token");
}

/**
 * s77 review m3: only a successful answer is reusable. A 429/503 from either
 * limiter (or a 401, or a 500) used to carry the same one-minute public cache
 * plus five minutes stale, so a browser or CDN could keep serving a refusal
 * long after its `Retry-After` — the limiter would have let go, the cache not.
 * A refusal is `private` (a 429 here is one address's, never a shared cache's
 * to hand out) and `no-cache` (never served again without asking us).
 *
 * TOMBSTONE (PR #82 CI): NOT `no-store`, which is what the m3 fix first used.
 * The widget reads this body only on an OK answer (`fetchActiveTests` returns
 * on `!response.ok`), and Chromium never finishes a fetch whose body nobody
 * reads unless its HTTP cache is writing the body down — `no-store` forbids
 * that, so every page view that drew a refusal held a request open forever.
 * The two realtime specs waited for network idle until they timed out, on every
 * retry; a prerenderer or crawler waiting for network idle on a customer's page
 * would hang the same way. Every widget ever installed has that early return,
 * so the header is where it is fixed.
 */
const REFUSAL_CACHE_CONTROL = "private, no-cache";

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type",
  );
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set(
    "Cache-Control",
    response.ok
      ? "public, max-age=60, stale-while-revalidate=300"
      : REFUSAL_CACHE_CONTROL,
  );
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    // s77 (s69 L7). Per IP, BEFORE authorization. The per-site limiter below has
    // to sit behind `authorizeSiteRequest` (an anonymous caller must not spend a
    // customer's bucket), which left the authorizer's `sites` lookup unmetered
    // for anyone naming a site id. 200/min per address: the content GET on the
    // same page view is already behind the same ceiling, so no visitor meets a
    // new one here. Fails CLOSED: every request this route would serve passes
    // the fail-closed per-site limiter anyway, so an outage refuses visitors
    // there regardless — failing open would only hand a flood the authorizer.
    const shed = await enforceRateLimit(request, {
      limit: "IP_GENERAL",
      endpoint: "ab-tests/active:ip",
      identifierType: "ip",
      onStoreFailure: "deny",
    });
    if (shed) return withCors(shed);

    const { siteId } = await params;
    const token = extractToken(request);

    let authorizedSiteId: string;
    try {
      ({
        site: { id: authorizedSiteId },
      } = await authorizeSiteRequest({
        siteId,
        token,
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
      }));
    } catch (authError) {
      return withCors(
        NextResponse.json(
          {
            error:
              authError instanceof Error ? authError.message : "Unauthorized",
          },
          { status: 401 },
        ),
      );
    }

    // Per site, fail closed, behind authorization — same shape and same reasons
    // as the per-site limiter on api/content/[siteId]/route.ts:455-473, which is
    // the other route a published site token opens onto the service-role client.
    // (ADR 002 rule 4)
    //
    // BEHIND the auth call rather than in front of it, despite the general rule
    // in AGENTS.md: the bucket is the customer's own, so metering an
    // unauthenticated caller into it would let anyone exhaust it by naming their
    // site id and take that customer's A/B tests offline. Bucketing per IP
    // instead would not bound what one copied token can do, which is the point.
    //
    // 1000/min because this is called on ORDINARY PAGE VIEWS. The response is
    // already cached for 60 s (see withCors above), so a busy site spends far
    // fewer than one request per view; 1000 leaves room for a traffic spike and
    // still caps a scraped token well below what it could otherwise cost us.
    //
    // Fail closed even though this is a read: a Redis outage costs the visitor
    // the A/B variant, and the widget then renders the page's own authored copy.
    // That is the degrade path it takes for any failed fetch. The GET on
    // /api/content fails OPEN instead because losing THAT un-publishes every
    // customer's copy at once — a different blast radius, hence a different call.
    //
    // s68b M4: keyed on the AUTHORIZED id. The authorizer finds the site through
    // a `uuid` cast (any case) and checks the token against the database's
    // `site.id`, so the upper-case spelling of a real id authorizes with the
    // genuine token — and metering the raw spelling gave every spelling its own
    // bucket. Spellings are still accepted (installed snippets are permanent);
    // they just share the one canonical bucket.
    const limited = await enforceRateLimit(request, {
      limit: "API_KEY_DEFAULT",
      endpoint: "ab-tests/active",
      identifier: authorizedSiteId,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "A/B test lookup rate limit exceeded for this site.",
    });
    if (limited) return withCors(limited);

    const supabase = createServiceRoleClient();

    const { data: tests, error } = await supabase
      .from("ab_tests")
      .select(
        `
        id,
        name,
        target_element_id,
        ab_test_variants (
          id,
          name,
          variant_content,
          traffic_percentage,
          is_control,
          geo_countries,
          geo_regions
        )
      `,
      )
      .eq("site_id", siteId)
      .eq("status", "active")
      // Control first, then id. The widget's client-side bucketing fallback
      // walks this list and accumulates traffic_percentage, so its answer is a
      // function of the order this response happens to arrive in — and Postgres
      // promises no order without an ORDER BY. Unordered, a returning visitor
      // gets silently reassigned whenever the planner changes its mind.
      // Mirrored in src/lib/ab-testing/bucketing.ts and in the widget.
      //
      // `nullsFirst: false` because `ORDER BY is_control DESC` puts NULLs first
      // in Postgres, while both walks read a NULL as "not the control" and sort
      // it last. The walks decide, so this changes no assignment — but a wire
      // order that contradicts the order the walk imposes on it is a trap for
      // whoever next reads one and assumes the other.
      .order("is_control", {
        ascending: false,
        nullsFirst: false,
        referencedTable: "ab_test_variants",
      })
      .order("id", { ascending: true, referencedTable: "ab_test_variants" });

    if (error) {
      console.error("Error fetching active A/B tests:", error);
      return withCors(
        NextResponse.json({ error: "Failed to fetch tests" }, { status: 500 }),
      );
    }

    const formattedTests = (tests || []).map((test) => ({
      id: test.id,
      name: test.name,
      target_element_id: test.target_element_id,
      variants: (
        test.ab_test_variants as Array<{
          id: string;
          name: string;
          variant_content: string;
          traffic_percentage: number;
          is_control: boolean;
          geo_countries: string[] | null;
          geo_regions: string[] | null;
        }>
      ).map((v) => ({
        id: v.id,
        name: v.name,
        variant_content: v.variant_content,
        traffic_percentage: v.traffic_percentage,
        is_control: v.is_control,
        geo_countries: v.geo_countries,
        geo_regions: v.geo_regions,
      })),
    }));

    return withCors(NextResponse.json({ tests: formattedTests }));
  } catch (error) {
    console.error("Active A/B tests error:", error);
    return withCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
    );
  }
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}
