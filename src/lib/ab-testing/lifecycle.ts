import { createServiceRoleClient } from "@/lib/supabase/service";

interface VariantStats {
  variant_id: string;
  variant_name: string;
  is_control: boolean;
  views: number;
  clicks: number;
  conversions: number;
  conversion_rate: number;
  total_value: number;
}

/**
 * Check if a test should auto-complete based on statistical significance
 */
export async function checkTestCompletion(testId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  // Fetch test config
  const { data: test, error: testError } = await supabase
    .from("ab_tests")
    .select("*, ab_test_variants(*)")
    .eq("id", testId)
    .single();

  if (testError || !test) {
    console.error("checkTestCompletion: test not found", testId);
    return;
  }

  if (test.status !== "active") return;

  const minSampleSize = test.min_sample_size || 100;
  const confidenceThreshold = test.confidence_threshold || 0.95;
  const variants = test.ab_test_variants || [];

  // Aggregate variant stats from ab_test_results
  const variantStats: VariantStats[] = [];

  for (const variant of variants) {
    const { count: views } = await supabase
      .from("ab_test_results")
      .select("id", { count: "exact", head: true })
      .eq("test_id", testId)
      .eq("variant_id", variant.id)
      .eq("event_type", "view");

    const { count: clicks } = await supabase
      .from("ab_test_results")
      .select("id", { count: "exact", head: true })
      .eq("test_id", testId)
      .eq("variant_id", variant.id)
      .eq("event_type", "click");

    const { count: conversions } = await supabase
      .from("ab_test_results")
      .select("id", { count: "exact", head: true })
      .eq("test_id", testId)
      .eq("variant_id", variant.id)
      .eq("event_type", "conversion");

    const viewCount = views ?? 0;
    const conversionCount = conversions ?? 0;

    variantStats.push({
      variant_id: variant.id,
      variant_name: variant.name,
      is_control: variant.is_control || false,
      views: viewCount,
      clicks: clicks ?? 0,
      conversions: conversionCount,
      conversion_rate: viewCount > 0 ? conversionCount / viewCount : 0,
      total_value: 0,
    });
  }

  // Check if we have enough samples
  const totalViews = variantStats.reduce((sum, v) => sum + v.views, 0);

  // Force-complete if past end date
  const now = new Date();
  const isPastEndDate = test.end_date && new Date(test.end_date) < now;

  if (totalViews < minSampleSize && !isPastEndDate) {
    return; // Not enough data yet
  }

  // Find control variant
  const controlStats = variantStats.find((v) => v.is_control);
  if (!controlStats) return;

  // Check significance for each treatment variant
  const treatmentStats = variantStats.filter((v) => !v.is_control);
  let winner: VariantStats | null = null;
  let isSignificant = false;

  for (const treatment of treatmentStats) {
    if (controlStats.views < 30 || treatment.views < 30) continue;

    const significance = calculateSignificance(
      controlStats.conversions,
      controlStats.views,
      treatment.conversions,
      treatment.views,
    );

    if (significance.confidence / 100 >= confidenceThreshold) {
      isSignificant = true;

      // Winner is the variant with higher conversion rate
      if (
        treatment.conversion_rate > controlStats.conversion_rate &&
        (!winner || treatment.conversion_rate > winner.conversion_rate)
      ) {
        winner = treatment;
      }
    }
  }

  // If no treatment beats control significantly, control wins
  if (isSignificant && !winner) {
    winner = controlStats;
  }

  // Auto-complete the test if significant or past end date
  const shouldComplete = test.auto_complete && (isSignificant || isPastEndDate);

  if (!shouldComplete) return;

  // Pick the best performer if no statistically significant winner
  if (!winner) {
    winner = variantStats.reduce((best, current) =>
      current.conversion_rate > best.conversion_rate ? current : best,
    );
  }

  // Update test status
  await supabase
    .from("ab_tests")
    .update({
      status: "completed",
      winner_variant: winner.variant_id,
      statistical_significance: isSignificant ? confidenceThreshold * 100 : 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", testId);

  // Promote winner content
  await promoteWinner(testId, winner.variant_id);

  console.log(
    `A/B test ${testId} completed. Winner: ${winner.variant_name} (${(winner.conversion_rate * 100).toFixed(2)}% CR)`,
  );
}

/**
 * Promote the winning variant's content to published content
 */
export async function promoteWinner(
  testId: string,
  winnerVariantId: string,
): Promise<void> {
  const supabase = createServiceRoleClient();

  // Get test and winner variant
  const { data: test } = await supabase
    .from("ab_tests")
    .select("site_id, target_element_id")
    .eq("id", testId)
    .single();

  if (!test || !test.target_element_id) return;

  const { data: variant } = await supabase
    .from("ab_test_variants")
    .select("variant_content, is_control")
    .eq("id", winnerVariantId)
    .single();

  if (!variant) return;

  // If winner is control, no content change needed
  if (variant.is_control) return;

  // Stage winner content for review via the existing staging/publish flow
  const { error: updateError } = await supabase
    .from("content_elements")
    .update({
      staging_content: variant.variant_content,
      staging_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("site_id", test.site_id)
    .eq("element_id", test.target_element_id);

  if (updateError) {
    console.error("Error promoting winner content:", updateError);
    return;
  }

  // Record in content history
  const { data: contentElement } = await supabase
    .from("content_elements")
    .select("id")
    .eq("site_id", test.site_id)
    .eq("element_id", test.target_element_id)
    .single();

  if (contentElement) {
    await supabase.from("content_history").insert({
      content_element_id: contentElement.id,
      content: variant.variant_content,
      change_type: "ab_test_winner",
    });
  }
}

/**
 * Z-test significance calculation (reused from existing results route)
 */
function calculateSignificance(
  controlConversions: number,
  controlViews: number,
  treatmentConversions: number,
  treatmentViews: number,
): { significant: boolean; confidence: number; pValue: number } {
  const controlRate = controlViews > 0 ? controlConversions / controlViews : 0;
  const treatmentRate =
    treatmentViews > 0 ? treatmentConversions / treatmentViews : 0;

  if (controlViews < 30 || treatmentViews < 30) {
    return { significant: false, confidence: 0, pValue: 1 };
  }

  const pooledRate =
    (controlConversions + treatmentConversions) /
    (controlViews + treatmentViews);
  const standardError = Math.sqrt(
    pooledRate * (1 - pooledRate) * (1 / controlViews + 1 / treatmentViews),
  );

  if (standardError === 0) {
    return { significant: false, confidence: 0, pValue: 1 };
  }

  const zScore = Math.abs(treatmentRate - controlRate) / standardError;
  const pValue = 2 * (1 - normalCDF(Math.abs(zScore)));
  const significant = pValue < 0.05;
  const confidence = (1 - pValue) * 100;

  return { significant, confidence, pValue };
}

function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);

  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return sign * y;
}
