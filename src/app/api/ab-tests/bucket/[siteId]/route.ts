import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { authorizeSiteRequest } from "@/lib/security/site-auth";
import { bucketVisitorToVariant } from "@/lib/ab-testing/bucketing";
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
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await params;
    const token = extractToken(request);
    const visitorId = request.nextUrl.searchParams.get("visitor_id");
    const geoHint = request.nextUrl.searchParams.get("geo_country");

    if (!visitorId) {
      return withCors(
        NextResponse.json({ error: "visitor_id is required" }, { status: 400 }),
      );
    }

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

    // Per site, fail closed, behind authorization — the pattern of the per-site
    // limiter on api/content/[siteId]/route.ts:455-473. (ADR 002 rule 4)
    //
    // This one WRITES: it upserts `visitor_buckets` with the service-role client,
    // so an unmetered token is an unbounded insert primitive against a table the
    // customer never sees. Behind the auth call for the reason given on the other
    // A/B routes — an unauthenticated caller must not be able to spend a
    // customer's bucket by naming their site id.
    //
    // 1000/min: one call per visitor per page view, and the widget persists the
    // assignment, so a real site sits far below it. A refusal costs the visitor
    // their variant for that load, not the page.
    const limited = await enforceRateLimit(request, {
      limit: "API_KEY_DEFAULT",
      endpoint: "ab-tests/bucket",
      identifier: siteId,
      identifierType: "api_key",
      onStoreFailure: "deny",
      message: "A/B bucketing rate limit exceeded for this site.",
    });
    if (limited) return withCors(limited);

    // Resolve geo from Vercel headers or client hint
    const geoCountry =
      request.headers.get("x-vercel-ip-country") || geoHint || null;
    const geoRegion = request.headers.get("x-vercel-ip-country-region") || null;

    const supabase = createServiceRoleClient();

    // Check for existing bucket assignments.
    //
    // The error is read, not dropped. This used to destructure `data` alone, so
    // a failed read — a missing table, a dead connection, a timeout — was
    // indistinguishable from "this visitor has never been bucketed". Every
    // returning visitor was then re-hashed and the persisted assignment
    // ignored, silently, with a 200 and a full set of assignments in the body.
    // Losing the stability guarantee is not something to paper over: the widget
    // can degrade to the page's own copy, but it must not be handed an
    // assignment we know might contradict the one already recorded.
    const { data: existingBuckets, error: existingBucketsError } =
      await supabase
        .from("visitor_buckets")
        .select("test_id, variant_id")
        .eq("site_id", siteId)
        .eq("visitor_id", visitorId);

    if (existingBucketsError) {
      console.error("Error reading visitor buckets:", existingBucketsError);
      return withCors(
        NextResponse.json(
          { error: "Failed to read assignments" },
          { status: 500 },
        ),
      );
    }

    const existingAssignments: Record<string, string> = {};
    for (const bucket of existingBuckets || []) {
      existingAssignments[bucket.test_id] = bucket.variant_id;
    }

    // Get active tests for this site
    const { data: tests, error: testsError } = await supabase
      .from("ab_tests")
      .select(
        `
        id,
        ab_test_variants (
          id,
          traffic_percentage,
          is_control,
          geo_countries,
          geo_regions
        )
      `,
      )
      .eq("site_id", siteId)
      .eq("status", "active")
      // Control first, then id — see orderVariantsForBucketing. The walk below
      // sorts for itself too; this keeps the wire order stable so the widget's
      // fallback and this route are looking at the same list. `nullsFirst:
      // false` for the reason spelled out in active/[siteId]/route.ts: DESC
      // puts NULLs first in Postgres and last in both walks.
      .order("is_control", {
        ascending: false,
        nullsFirst: false,
        referencedTable: "ab_test_variants",
      })
      .order("id", { ascending: true, referencedTable: "ab_test_variants" });

    if (testsError) {
      console.error("Error fetching tests for bucketing:", testsError);
      return withCors(
        NextResponse.json({ error: "Failed to fetch tests" }, { status: 500 }),
      );
    }

    const assignments: Record<string, string> = { ...existingAssignments };
    const newBuckets: Array<{
      site_id: string;
      visitor_id: string;
      test_id: string;
      variant_id: string;
      geo_country: string | null;
      geo_region: string | null;
    }> = [];

    for (const test of tests || []) {
      if (assignments[test.id]) continue; // Already assigned

      const variants = test.ab_test_variants as Array<{
        id: string;
        traffic_percentage: number;
        is_control: boolean;
        geo_countries: string[] | null;
        geo_regions: string[] | null;
      }>;

      const variantId = bucketVisitorToVariant(
        visitorId,
        test.id,
        variants,
        geoCountry,
        geoRegion,
      );

      if (variantId) {
        assignments[test.id] = variantId;
        newBuckets.push({
          site_id: siteId,
          visitor_id: visitorId,
          test_id: test.id,
          variant_id: variantId,
          geo_country: geoCountry,
          geo_region: geoRegion,
        });
      }
    }

    // Persist new assignments
    if (newBuckets.length > 0) {
      const { error: insertError } = await supabase
        .from("visitor_buckets")
        .upsert(newBuckets, { onConflict: "visitor_id,test_id" });

      // Same reasoning as the read above, one step later: an assignment that
      // was not persisted is an assignment that will be recomputed on the next
      // page load, and the visitor may well get a different variant then. This
      // used to log and return 200 with the assignment anyway, which is a
      // promise the database did not make.
      if (insertError) {
        console.error("Error persisting visitor buckets:", insertError);
        return withCors(
          NextResponse.json(
            { error: "Failed to persist assignments" },
            { status: 500 },
          ),
        );
      }
    }

    return withCors(
      NextResponse.json({
        assignments,
        geo: { country: geoCountry, region: geoRegion },
      }),
    );
  } catch (error) {
    console.error("Bucket visitor error:", error);
    return withCors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 }),
    );
  }
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}
