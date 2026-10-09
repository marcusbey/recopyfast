import type { MetadataRoute } from "next";
import { createAnonClient } from "@/lib/supabase/anon";
import { comparisonList } from "@/lib/compare/comparisons";
import { resolveSiteUrl } from "@/lib/seo/site-url";

/**
 * Regenerated at most hourly (s88).
 *
 * Until s88 this route read through the cookie client, and `cookies()` made it
 * render — and query Supabase — on every crawler fetch. Reading as `anon` makes
 * it static, and a static sitemap with no `revalidate` is built once per deploy:
 * a post published after the deploy would never appear. The blog cron publishes
 * at most daily, so an hour of lag costs nothing a crawler would notice.
 */
export const revalidate = 3600;

type StaticRoute = {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
};

/**
 * Public, indexable routes: each resolves a canonical to itself
 * (src/__tests__/app/seo-canonicals.test.ts). A noindex page must not be here
 * — search consoles report a listed noindex URL as an error — so `/login` and
 * `/signup`, bare auth forms marked noindex in s88, left this list then.
 * `/auth/*` and everything under `/dashboard` and `/api` are excluded too — see
 * `robots.ts`.
 *
 * No entry carries `lastModified`. Until s88 every one said `new Date()`, so
 * every crawl claimed every page had just changed — which teaches crawlers to
 * ignore this file's dates, the real ones on blog posts included. No page
 * records when its content last changed, so none is claimed.
 */
const STATIC_ROUTES: readonly StaticRoute[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/demo", changeFrequency: "monthly", priority: 0.8 },
  { path: "/try", changeFrequency: "monthly", priority: 0.9 },
  { path: "/docs/install", changeFrequency: "monthly", priority: 0.8 },
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
 * Read as `anon` (`createAnonClient`): the `"Published blog posts are public"`
 * policy gives that role exactly the published rows, so the file cannot depend
 * on who requested it, and the service role — RLS off — is not needed. The
 * `status` filter stays anyway: it is what keeps drafts out if this ever reads
 * through a role that can see them.
 *
 * Degrades to the static routes when the read fails, so a Supabase outage
 * cannot take the sitemap down with a 500. It logs: until s88 a failed read
 * returned `[]` silently, and a sitemap missing every post looked healthy.
 */
async function getBlogRoutes(): Promise<BlogPostEntry[]> {
  try {
    const supabase = createAnonClient();

    const { data, error } = await supabase
      .from("blog_posts")
      .select("slug, published_at, updated_at")
      .eq("status", "published")
      .order("published_at", { ascending: false });

    if (error) {
      console.error(
        "[sitemap] could not read published blog posts:",
        error.message,
      );
      return [];
    }

    return (data ?? []) as BlogPostEntry[];
  } catch (error) {
    console.error("[sitemap] could not read published blog posts:", error);
    return [];
  }
}

/** A post's last real change: its update, else its publication, else none. */
function postLastModified(post: BlogPostEntry): Date | undefined {
  const stamp = post.updated_at ?? post.published_at;
  return stamp ? new Date(stamp) : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = resolveSiteUrl();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${siteUrl}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const posts = await getBlogRoutes();

  const blogEntries: MetadataRoute.Sitemap = posts.map((post) => {
    const lastModified = postLastModified(post);
    return {
      url: `${siteUrl}/blog/${post.slug}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "monthly",
      priority: 0.6,
    };
  });

  return [...staticEntries, ...blogEntries];
}
