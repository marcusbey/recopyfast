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
      .eq("status", "active");

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
  return withCors(NextResponse.json({}, { status: 204 }));
}
