import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { aiService } from "@/lib/ai/openai-service";
import {
  CREDIT_COSTS,
  hasEnoughCredits,
  consumeCredits,
} from "@/lib/credits/system";
import { getEffectivePlan } from "@/lib/billing/entitlements";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      site_id,
      element_id,
      original_text,
      context,
      tone,
      num_variants = 3,
    } = body;

    if (!site_id || !element_id || !original_text) {
      return NextResponse.json(
        {
          error: "Missing required fields: site_id, element_id, original_text",
        },
        { status: 400 },
      );
    }

    // Authenticate user
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

    // A/B testing is a plan capability, not metered usage, so credits alone do
    // not unlock it even though generating a test also costs credits.
    const entitlement = await getEffectivePlan(user.id);

    if (entitlement.kind !== "plan") {
      return NextResponse.json(
        {
          error:
            entitlement.kind === "credits"
              ? "A/B testing requires a plan. Your credits cover AI suggestions and translations."
              : "This account has no active plan. Choose a plan to continue.",
          upgrade_required: true,
        },
        { status: 403 },
      );
    }

    if (!entitlement.plan.limits.abTesting) {
      return NextResponse.json(
        {
          error: "A/B testing requires a Pro plan",
          upgrade_required: true,
        },
        { status: 403 },
      );
    }

    // Check credits
    const creditCost = CREDIT_COSTS.AB_TEST_GENERATION;
    const hasCredits = await hasEnoughCredits(user.id, creditCost);
    if (!hasCredits) {
      return NextResponse.json(
        {
          error: `Insufficient credits. A/B test generation requires ${creditCost} credits.`,
          credits_required: creditCost,
        },
        { status: 402 },
      );
    }

    // Generate AI variants
    const aiResult = await aiService.generateABVariants({
      originalText: original_text,
      context: context || "website copy",
      elementType: element_id.includes("h1")
        ? "h1"
        : element_id.includes("button")
          ? "button"
          : "p",
      tone,
      numVariants: Math.min(num_variants, 5),
    });

    if (!aiResult.success || !aiResult.data) {
      return NextResponse.json(
        { error: aiResult.error || "AI generation failed" },
        { status: 500 },
      );
    }

    // Consume credits
    const creditResult = await consumeCredits(
      user.id,
      creditCost,
      "ab_test_generation",
      { site_id, element_id },
    );

    if (!creditResult.success) {
      return NextResponse.json({ error: creditResult.error }, { status: 402 });
    }

    // Create the test in draft status using service role client
    const serviceSupabase = createServiceRoleClient();

    const { data: test, error: testError } = await serviceSupabase
      .from("ab_tests")
      .insert({
        site_id,
        name: `A/B Test: ${original_text.substring(0, 50)}...`,
        description: `AI-generated variants for element ${element_id}`,
        target_element_id: element_id,
        status: "draft",
        traffic_split: 0.5,
        success_metric: "conversion_rate",
        auto_complete: true,
        min_sample_size: 100,
        confidence_threshold: 0.95,
        created_by: user.id,
      })
      .select()
      .single();

    if (testError) {
      console.error("Error creating A/B test:", testError);
      return NextResponse.json(
        { error: "Failed to create test" },
        { status: 500 },
      );
    }

    // Create variants: control + AI-generated
    const variantsToInsert = [
      {
        test_id: test.id,
        name: "Control (Original)",
        variant_content: original_text,
        content_changes: {},
        traffic_percentage: Math.round(100 / (aiResult.data.length + 1)),
        is_control: true,
      },
      ...aiResult.data.map((variant) => ({
        test_id: test.id,
        name: variant.name,
        variant_content: variant.content,
        content_changes: {},
        traffic_percentage: Math.round(100 / (aiResult.data!.length + 1)),
        is_control: false,
      })),
    ];

    // Ensure traffic percentages sum to 100
    const totalTraffic = variantsToInsert.reduce(
      (sum, v) => sum + v.traffic_percentage,
      0,
    );
    if (totalTraffic !== 100) {
      variantsToInsert[0].traffic_percentage += 100 - totalTraffic;
    }

    const { data: variants, error: variantsError } = await serviceSupabase
      .from("ab_test_variants")
      .insert(variantsToInsert)
      .select();

    if (variantsError) {
      console.error("Error creating variants:", variantsError);
      await serviceSupabase.from("ab_tests").delete().eq("id", test.id);
      return NextResponse.json(
        { error: "Failed to create variants" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      test: {
        ...test,
        variants,
      },
      ai_rationales: aiResult.data.map((v) => ({
        name: v.name,
        rationale: v.rationale,
      })),
      credits_used: creditCost,
      remaining_credits: creditResult.remainingCredits,
    });
  } catch (error) {
    console.error("Generate A/B test error:", error);
    return NextResponse.json(
      { error: "Failed to generate A/B test" },
      { status: 500 },
    );
  }
}
