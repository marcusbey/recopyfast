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

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type",
  );
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set(
    "Cache-Control",
    "public, max-age=60, stale-while-revalidate=300",
  );
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;
    const token = extractToken(request);

    try {
      await authorizeSiteRequest({
        siteId,
        token,
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
      });
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
    const limited = await enforceRateLimit(request, {
      limit: "API_KEY_DEFAULT",
      endpoint: "ab-tests/active",
      identifier: siteId,
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
