import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { authorizeSiteRequest } from "@/lib/security/site-auth";

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

/**
 * FNV-1a hash for deterministic bucketing
 */
function fnv1aHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

function bucketVisitorToVariant(
  visitorId: string,
  testId: string,
  variants: Array<{
    id: string;
    traffic_percentage: number;
    is_control: boolean;
    geo_countries: string[] | null;
    geo_regions: string[] | null;
  }>,
  geoCountry?: string | null,
  geoRegion?: string | null,
): string | null {
  // Filter variants by geo eligibility
  const eligible = variants.filter((v) => {
    if (v.geo_countries && v.geo_countries.length > 0 && geoCountry) {
      if (!v.geo_countries.includes(geoCountry)) return false;
    }
    if (v.geo_regions && v.geo_regions.length > 0 && geoRegion) {
      if (!v.geo_regions.includes(geoRegion)) return false;
    }
    return true;
  });

  if (eligible.length === 0) return null;

  // Deterministic bucket 0-99
  const bucket = fnv1aHash(`${visitorId}:${testId}`) % 100;

  // Map to variant by cumulative traffic percentage
  let cumulative = 0;
  for (const variant of eligible) {
    cumulative += variant.traffic_percentage;
    if (bucket < cumulative) {
      return variant.id;
    }
  }

  // Fallback to last eligible variant
  return eligible[eligible.length - 1].id;
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

    // Resolve geo from Vercel headers or client hint
    const geoCountry =
      request.headers.get("x-vercel-ip-country") || geoHint || null;
    const geoRegion = request.headers.get("x-vercel-ip-country-region") || null;

    const supabase = createServiceRoleClient();

    // Check for existing bucket assignments
    const { data: existingBuckets } = await supabase
      .from("visitor_buckets")
      .select("test_id, variant_id")
      .eq("site_id", siteId)
      .eq("visitor_id", visitorId);

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
      .eq("status", "active");

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

      if (insertError) {
        console.error("Error persisting visitor buckets:", insertError);
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
  return withCors(NextResponse.json({}, { status: 204 }));
}
