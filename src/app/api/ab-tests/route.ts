import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ABTest, ABTestVariant } from "@/types";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  checkOwnerCanEdit,
  ownerCanEditRefusal,
} from "@/lib/billing/owner-can-edit";

/**
 * The only `ab_tests` columns a PUT may write (s56, ADR 042).
 *
 * The update used to spread the request body into the row (`...updates`).
 * RLS `WITH CHECK` on `site_id` was the only thing stopping a caller moving a
 * test onto another tenant's site, or rewriting `created_by`/`id`. The write
 * now runs as the service role, which checks nothing, so anything not listed
 * here is ignored. These are the fields the A/B screens send
 * (`useABTests`, `useABTestCreation`) plus the test's own settings.
 */
const UPDATABLE_TEST_FIELDS = [
  "name",
  "description",
  "status",
  "traffic_split",
  "success_metric",
  "start_date",
  "end_date",
  "target_element_id",
  "auto_complete",
  "min_sample_size",
  "confidence_threshold",
] as const;

function pickUpdatableFields(
  body: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    UPDATABLE_TEST_FIELDS.filter((field) =>
      Object.prototype.hasOwnProperty.call(body, field),
    ).map((field) => [field, body[field]]),
  );
}

/**
 * Rate limit before authorization, per AGENTS.md: `getUser()` and the
 * permission read cost round trips a flood would otherwise buy for free.
 * `deny` on store failure: since s56 these writes run as the service role, and
 * a service-role write path is fail-closed or it does not exist.
 */
function limitWrites(req: NextRequest, endpoint: string) {
  return enforceRateLimit(req, {
    limit: "API_UPLOAD",
    endpoint,
    onStoreFailure: "deny",
  });
}

interface ABTestVariantInput {
  content_element_id: string;
  variant_name: string;
  content: string;
  traffic_percentage: number;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");

    if (!siteId) {
      return NextResponse.json(
        { error: "Missing siteId parameter" },
        { status: 400 },
      );
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check site permissions
    const { data: permission } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", siteId)
      .eq("user_id", user.id)
      .single();

    if (!permission) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // Get A/B tests with variants
    const { data: tests, error } = await supabase
      .from("ab_tests")
      .select(
        `
        *,
        variants:ab_test_variants(*)
      `,
      )
      .eq("site_id", siteId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json(tests || []);
  } catch (error) {
    console.error("Get A/B tests error:", error);
    return NextResponse.json(
      { error: "Failed to fetch A/B tests" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = await limitWrites(req, "ab-tests:create");
    if (limited) return limited;

    const body = await req.json();
    const {
      site_id,
      name,
      description,
      traffic_split,
      success_metric,
      variants,
      start_date,
      end_date,
    } = body;

    if (
      !site_id ||
      !name ||
      !success_metric ||
      !variants ||
      variants.length < 2
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: site_id, name, success_metric, variants (min 2)",
        },
        { status: 400 },
      );
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check site permissions
    const { data: permission } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", site_id)
      .eq("user_id", user.id)
      .single();

    if (!permission || !["edit", "admin"].includes(permission.permission)) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // A test serves its variants' copy to visitors, so creating one is a
    // content write and needs the SITE OWNER's plan (s56 closes ADR 041's
    // "Watch": `ab-tests/*` was in neither list). After the permission read so
    // it is no oracle, before any write.
    const ownerCanEdit = await checkOwnerCanEdit(site_id);
    if (!ownerCanEdit.ok) {
      return ownerCanEditRefusal(ownerCanEdit);
    }

    // Validate traffic percentages
    const totalTraffic = variants.reduce(
      (sum: number, v: ABTestVariantInput) => sum + (v.traffic_percentage || 0),
      0,
    );
    if (totalTraffic !== 100) {
      return NextResponse.json(
        { error: "Traffic percentages must sum to 100%" },
        { status: 400 },
      );
    }

    // The writes go through the service role (s56, ADR 042): no web principal
    // holds DML on the A/B tables any more, because a member's direct
    // PostgREST write bypassed the owner-plan gate. Created only after
    // `getUser()`, the `edit`/`admin` read and the gate; the test's `site_id`
    // is the one that read checked, and the variants hang off the test just
    // inserted — RLS no longer re-checks either (ADR 037 step 5).
    const service = createServiceRoleClient();

    // Create A/B test
    const { data: test, error: testError } = await service
      .from("ab_tests")
      .insert({
        site_id,
        name,
        description,
        traffic_split: traffic_split || 0.5,
        success_metric,
        start_date,
        end_date,
        created_by: user.id,
        status: "draft",
      })
      .select()
      .single();

    if (testError) {
      throw testError;
    }

    // Create variants
    const variantInserts = variants.map((variant: ABTestVariantInput) => ({
      test_id: test.id,
      content_element_id: variant.content_element_id,
      variant_name: variant.variant_name,
      content: variant.content,
      traffic_percentage: variant.traffic_percentage,
    }));

    const { error: variantsError } = await service
      .from("ab_test_variants")
      .insert(variantInserts);

    if (variantsError) {
      // Cleanup test if variants failed
      await service.from("ab_tests").delete().eq("id", test.id);
      throw variantsError;
    }

    return NextResponse.json(test);
  } catch (error) {
    console.error("Create A/B test error:", error);
    return NextResponse.json(
      { error: "Failed to create A/B test" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const limited = await limitWrites(req, "ab-tests:update");
    if (limited) return limited;

    const body = await req.json();
    const { test_id } = body;
    const updates = pickUpdatableFields(body);

    if (!test_id) {
      return NextResponse.json({ error: "Missing test_id" }, { status: 400 });
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => req.cookies.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get test and verify permissions
    const { data: test, error: testError } = await supabase
      .from("ab_tests")
      .select("site_id, created_by")
      .eq("id", test_id)
      .single();

    if (testError || !test) {
      return NextResponse.json({ error: "Test not found" }, { status: 404 });
    }

    // Check permissions
    const { data: permission } = await supabase
      .from("site_permissions")
      .select("permission")
      .eq("site_id", test.site_id)
      .eq("user_id", user.id)
      .single();

    if (!permission || !["edit", "admin"].includes(permission.permission)) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    // Starting, pausing or reconfiguring a served test needs the SITE OWNER's
    // plan (s56, ADR 041 "Watch"), keyed by the test's own site as read above
    // through the caller's client — never a site named in the body.
    const ownerCanEdit = await checkOwnerCanEdit(test.site_id);
    if (!ownerCanEdit.ok) {
      return ownerCanEditRefusal(ownerCanEdit);
    }

    // Update test, through the service role (s56, ADR 042), writing only the
    // allowlist and scoped to this test on the site the checks established.
    const { data: updatedTest, error: updateError } =
      await createServiceRoleClient()
        .from("ab_tests")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", test_id)
        .eq("site_id", test.site_id)
        .select()
        .single();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json(updatedTest);
  } catch (error) {
    console.error("Update A/B test error:", error);
    return NextResponse.json(
      { error: "Failed to update A/B test" },
      { status: 500 },
    );
  }
}
