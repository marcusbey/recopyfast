import { ComparisonPage } from "@/components/compare/ComparisonPage";
import {
  comparisons,
  createComparisonMetadata,
} from "@/lib/compare/comparisons";
import { loadComparisonPricing } from "@/lib/compare/comparison-pricing";

const comparison = comparisons["webflow-editor"];

export const metadata = createComparisonMetadata(comparison);
export const dynamic = "force-dynamic";

export default async function WebflowEditorComparisonPage() {
  const pricing = await loadComparisonPricing();
  return <ComparisonPage comparison={comparison} pricing={pricing} />;
}
