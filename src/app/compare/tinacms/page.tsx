import { ComparisonPage } from "@/components/compare/ComparisonPage";
import {
  comparisons,
  createComparisonMetadata,
} from "@/lib/compare/comparisons";

const comparison = comparisons.tinacms;

export const metadata = createComparisonMetadata(comparison);

export default function TinaCmsComparisonPage() {
  return <ComparisonPage comparison={comparison} />;
}
