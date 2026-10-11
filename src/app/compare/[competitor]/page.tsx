import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ComparisonPage } from "@/components/compare/ComparisonPage";
import {
  comparisonList,
  createComparisonMetadata,
  getComparison,
} from "@/lib/compare/comparisons";
import { loadComparisonPricing } from "@/lib/compare/comparison-pricing";
import { loadCatalogueOffers } from "@/lib/seo/catalogue-offers";
import { resolveSiteUrl } from "@/lib/seo/site-url";

type ComparisonRouteProps = {
  params: Promise<{ competitor: string }>;
};

export const revalidate = 300;
// The page-level `notFound()` runs after the root loading boundary can stream a
// 200 shell. Restricting the segment to registry-generated params lets Next
// reject unknown and prototype-shaped slugs before any response is committed.
export const dynamicParams = false;

export function buildComparisonStaticParams(
  comparisons: readonly { readonly slug: string }[] = comparisonList,
) {
  return comparisons.map((comparison) => ({
    competitor: comparison.slug,
  }));
}

export function generateStaticParams() {
  return buildComparisonStaticParams();
}

export async function generateMetadata({
  params,
}: ComparisonRouteProps): Promise<Metadata> {
  const { competitor } = await params;
  const comparison = getComparison(competitor);
  if (!comparison) notFound();

  return createComparisonMetadata(comparison);
}

export default async function ComparisonRoute({
  params,
}: ComparisonRouteProps) {
  const { competitor } = await params;
  const comparison = getComparison(competitor);
  if (!comparison) notFound();

  const [pricing, offers] = await Promise.all([
    loadComparisonPricing(),
    loadCatalogueOffers(resolveSiteUrl()),
  ]);
  return (
    <ComparisonPage comparison={comparison} pricing={pricing} offers={offers} />
  );
}
