import { ComparisonPage } from "@/components/compare/ComparisonPage";
import {
  comparisons,
  createComparisonMetadata,
} from "@/lib/compare/comparisons";
import { loadComparisonPricing } from "@/lib/compare/comparison-pricing";

const comparison = comparisons.duda;

export const metadata = createComparisonMetadata(comparison);
export const revalidate = 300;

export default async function DudaComparisonPage() {
  const pricing = await loadComparisonPricing();
  return <ComparisonPage comparison={comparison} pricing={pricing} />;
}
