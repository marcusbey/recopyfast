import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { aiService } from "@/lib/ai/openai-service";
import {
  CREDIT_COSTS,
  consumeCredits,
  refundCharge,
  type CreditCharge,
} from "@/lib/credits/system";
import { resolveEntitlement } from "@/lib/billing/effective-plan";
import {
  checkOwnerCanEdit,
  ownerCanEditRefusal,
} from "@/lib/billing/owner-can-edit";
import { enforceRateLimit } from "@/lib/api/rate-limit";

/**
 * Generating an A/B test is the SITE OWNER's capability and the owner's spend
 * (s56, ADR 042), in the `ai/suggest` shape (ADR 035/040).
 *
 * WHAT BROKE. The plan check, the credit check and the charge all read the
 * CALLER. A collaborator holding a plan could create tests — served copy — on
 * a lapsed owner's site, around the owner-plan gate (ADR 041 "Watch"), and a
 * collaborator without one was refused on a paying owner's site. The credit
 * check (`hasEnoughCredits`) also read through the cookie client, where RLS
 * hides the owner's wallet from a collaborator. And the charge came AFTER the
 * model: a refused charge had already bought an OpenAI call.
 *
 * NOW. Owner gate, then the owner's `abTesting` capability read with the
 * service role, then the owner's charge, then the model, then the writes —
 * every failure after the charge refunds exactly that receipt.
 */
export async function POST(req: NextRequest) {
  // The receipt of THIS request's charge, once it has landed. The catch
  // refunds exactly that: a failure before the charge gives nothing back.
  let charge: CreditCharge | null = null;

  try {
    // Rate limit before authorization, per AGENTS.md. `deny` on store
    // failure: every accepted request is a charged OpenAI call and a
    // service-role write, and losing Redis must not unmeter either.
    const limited = await enforceRateLimit(req, {
      limit: "API_UPLOAD",
      endpoint: "ab-tests/generate",
      onStoreFailure: "deny",
    });
    if (limited) return limited;

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

    // The owner's plan, after the permission read so it is no oracle. Keyed
    // to the owner, never the caller (ADR 041).
    const ownerCanEdit = await checkOwnerCanEdit(site_id);
    if (!ownerCanEdit.ok) {
      return ownerCanEditRefusal(ownerCanEdit);
    }
    const ownerId = ownerCanEdit.ownerId;

    // The service role reads the owner's entitlement and wallet (RLS would
    // hide both from a collaborator) and writes the test (s56: no web
    // principal holds DML on the A/B tables). Created only after `getUser()`,
    // the `edit`/`admin` read and the gate.
    const service = createServiceRoleClient();

    // A/B testing is a plan capability, not metered usage, so credits alone do
    // not unlock it even though generating a test also costs credits. The
    // gate above already refused a credits-only or lapsed owner; the same
    // answer covers a plan that ended in between.
    const entitlement = await resolveEntitlement(service, ownerId);
    if (entitlement.kind !== "plan") {
      return ownerCanEditRefusal({ ok: false, reason: "plan_ended" });
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

    // Charge the OWNER, before the model is called: a refused charge must not
    // have bought an OpenAI call. The service client is what makes `ownerId`
    // the wallet read and spent (credits/system.ts, `consumeCredits`).
    const creditCost = CREDIT_COSTS.AB_TEST_GENERATION;
    const creditResult = await consumeCredits(
      ownerId,
      creditCost,
      "ab_test_generation",
      { site_id, element_id },
      service,
    );

    if (!creditResult.success) {
      return NextResponse.json(
        {
          error:
            creditResult.error ??
            `Insufficient credits. A/B test generation requires ${creditCost} credits.`,
          credits_required: creditCost,
        },
        { status: 402 },
      );
    }
    charge = creditResult.charge ?? null;

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
      await refundOnce();
      return NextResponse.json(
        { error: aiResult.error || "AI generation failed" },
        { status: 500 },
      );
    }

    // Create the test in draft status, on the site the checks established.
    const { data: test, error: testError } = await service
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
      await refundOnce();
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

    const { data: variants, error: variantsError } = await service
      .from("ab_test_variants")
      .insert(variantsToInsert)
      .select();

    if (variantsError) {
      console.error("Error creating variants:", variantsError);
      await service.from("ab_tests").delete().eq("id", test.id);
      await refundOnce();
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
    await refundOnce();
    return NextResponse.json(
      { error: "Failed to generate A/B test" },
      { status: 500 },
    );
  }

  /** Gives this request's charge back, once: cleared before the catch sees it. */
  async function refundOnce(): Promise<void> {
    const landed = charge;
    charge = null;
    if (landed) {
      await refundCharge(landed);
    }
  }
}
