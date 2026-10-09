import { ALTERNATIVES } from "@/content/alternatives";
import { resolveSiteUrl } from "@/lib/seo/site-url";
import { NextResponse } from "next/server";

export function GET() {
  const siteUrl = resolveSiteUrl();
  const comparisons = ALTERNATIVES.map(
    (entry) =>
      `- [${entry.name} alternative](${siteUrl}/alternatives/${entry.slug}): ${entry.metaDescription}`,
  );
  const body = [
    "# ReCopyFast",
    "",
    "> ReCopyFast adds bounded content editing to an existing rendered website.",
    "",
    "## Product",
    `- [Home](${siteUrl}/)`,
    `- [Interactive demo](${siteUrl}/demo)`,
    `- [Blog](${siteUrl}/blog)`,
    "",
    "## Comparisons",
    ...comparisons,
    "",
    "This inventory does not guarantee indexing, ranking, or citation.",
    "",
  ].join("\n");

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
