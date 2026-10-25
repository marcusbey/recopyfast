import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuidePage } from "@/components/guides/GuidePage";
import { createGuideMetadata } from "@/lib/guides/guide-registry";
import { getGuide, guideList } from "@/lib/guides/guides";

type GuideRouteProps = {
  params: Promise<{ slug: string }>;
};

// Same reason as /compare/[competitor]: `notFound()` in the page runs after
// the root loading boundary can stream a 200 shell, so the segment accepts
// only registry slugs and Next rejects anything else before responding.
// No `revalidate`: a guide reads no data, so every page is built once (SSG).
export const dynamicParams = false;

export function generateStaticParams() {
  return guideList.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: GuideRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();
  return createGuideMetadata(guide);
}

export default async function GuideRoute({ params }: GuideRouteProps) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();
  return <GuidePage guide={guide} />;
}
