import { ComparisonPage } from "@/components/compare/ComparisonPage";
import {
  comparisons,
  createComparisonMetadata,
} from "@/lib/compare/comparisons";

const comparison = comparisons["webflow-editor"];

export const metadata = createComparisonMetadata(comparison);

export default function WebflowEditorComparisonPage() {
  return <ComparisonPage comparison={comparison} />;
}
