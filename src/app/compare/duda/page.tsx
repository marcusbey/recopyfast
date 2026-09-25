import { ComparisonPage } from "@/components/compare/ComparisonPage";
import {
  comparisons,
  createComparisonMetadata,
} from "@/lib/compare/comparisons";

const comparison = comparisons.duda;

export const metadata = createComparisonMetadata(comparison);

export default function DudaComparisonPage() {
  return <ComparisonPage comparison={comparison} />;
}
