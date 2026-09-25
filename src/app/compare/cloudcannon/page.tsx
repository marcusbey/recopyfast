import { ComparisonPage } from "@/components/compare/ComparisonPage";
import {
  comparisons,
  createComparisonMetadata,
} from "@/lib/compare/comparisons";

const comparison = comparisons.cloudcannon;

export const metadata = createComparisonMetadata(comparison);

export default function CloudCannonComparisonPage() {
  return <ComparisonPage comparison={comparison} />;
}
