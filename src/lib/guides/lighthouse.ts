import type { Guide } from "@/lib/guides/guide-registry";
import { guideList } from "@/lib/guides/guides";

/**
 * The guide routes ADR 013's Lighthouse gate measures (s123): the `/guides`
 * index and the first guide in the registry. Every guide renders through the
 * one `GuidePage` template with no data of its own, so one detail page
 * measures the template; measuring all of them would add five routes × five
 * runs to a job whose cost is its runtime. Read from the registry, like the
 * comparison list, so a renamed slug cannot leave the gate pointing at a 404.
 */
export function buildGuideLighthouseUrls(
  baseUrl: string,
  guides: readonly Guide[] = guideList,
): string[] {
  const origin = new URL(baseUrl).origin;
  const first = guides[0];
  if (!first) throw new Error("the guide registry is empty");
  return [`${origin}/guides`, `${origin}/guides/${first.slug}`];
}
