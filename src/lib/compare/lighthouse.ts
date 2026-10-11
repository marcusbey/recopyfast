import { comparisonList, type Comparison } from "@/lib/compare/comparisons";

/**
 * ADR 013 originally listed five future `/alternatives` pages by hand. That
 * list was already stale when ADR 032 moved the shipped cluster to `/compare`.
 * Lighthouse now reads the same registry as routing, the hub, sitemap and
 * llms.txt, so a valid data-only addition cannot escape the performance gate.
 */
export function buildComparisonLighthouseUrls(
  baseUrl: string,
  comparisons: readonly Comparison[] = comparisonList,
): string[] {
  const origin = new URL(baseUrl).origin;
  return [
    `${origin}/compare`,
    ...comparisons.map((comparison) => `${origin}/compare/${comparison.slug}`),
  ];
}
