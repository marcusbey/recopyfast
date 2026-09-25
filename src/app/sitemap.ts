import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { comparisonList } from "@/lib/compare/comparisons";
import { resolveSiteUrl } from "@/lib/seo/site-url";

type StaticRoute = {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
};

/**
 * Public, indexable routes. `/auth/*` and everything under `/dashboard` and
 * `/api` are intentionally excluded — see `robots.ts`.
 */
const STATIC_ROUTES: readonly StaticRoute[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/demo", changeFrequency: "monthly", priority: 0.8 },
  { path: "/try", changeFrequency: "monthly", priority: 0.9 },
  { path: "/compare", changeFrequency: "monthly", priority: 0.8 },
  ...comparisonList.map(
    (comparison) =>
      ({
        path: `/compare/${comparison.slug}`,
        changeFrequency: "monthly",
        priority: 0.7,
      }) as const,
  ),
  { path: "/blog", changeFrequency: "daily", priority: 0.7 },
  { path: "/login", changeFrequency: "yearly", priority: 0.3 },
  { path: "/signup", changeFrequency: "yearly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
];

type BlogPostEntry = {
  slug: string;
  published_at: string | null;
  updated_at: string | null;
};

/**
 * Published blog posts, mirroring the query in `src/app/blog/[slug]/page.tsx`.
 *
 * Returns an empty list rather than throwing when the database is unreachable
 * or unconfigured, so a Supabase outage degrades the sitemap to its static
 * routes instead of taking the whole route down with a 500.
 */
async function getBlogRoutes(): Promise<BlogPostEntry[]> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("blog_posts")
      .select("slug, published_at, updated_at")
      .eq("status", "published")
      .order("published_at", { ascending: false });

    if (error || !data) {
      return [];
    }

    return data as BlogPostEntry[];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = resolveSiteUrl();
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${siteUrl}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const posts = await getBlogRoutes();

  const blogEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${siteUrl}/blog/${post.slug}`,
    lastModified: new Date(post.updated_at ?? post.published_at ?? now),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticEntries, ...blogEntries];
}
