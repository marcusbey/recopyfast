import { createAnonClient } from "@/lib/supabase/anon";

/**
 * One published post as the `/blog` index shows it: only what `blog_posts`
 * holds. The index once also showed a "Featured" hero and a read time; no
 * column backs "featured", and a read time would mean reading every article's
 * full `content` here (`/blog/<slug>` still shows its own).
 */
export interface PublishedPostSummary {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  category: string;
  publishedAt: string | null;
}

/**
 * A failed read is its own outcome, never an empty list: an empty blog and a
 * blog that could not be read are different things to say to a visitor
 * (`docs/design-system.md` § States).
 */
export type PublishedPostsResult =
  | { ok: true; posts: PublishedPostSummary[] }
  | { ok: false };

type PublishedPostRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  category: string;
  published_at: string | null;
};

const LOG_PREFIX = "[blog] could not read published posts:";

function toSummary(row: PublishedPostRow): PublishedPostSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    category: row.category,
    publishedAt: row.published_at,
  };
}

/**
 * Published posts, newest first, read as `anon` (ADR 058) — the same read the
 * sitemap makes. The `"Published blog posts are public"` policy gives that role
 * exactly the published rows; the `status` filter stays so drafts stay out if
 * this is ever pointed at a role that can see them (a platform admin's session
 * can: the admin policy is `FOR ALL`).
 */
export async function listPublishedPosts(): Promise<PublishedPostsResult> {
  try {
    const supabase = createAnonClient();

    const { data, error } = await supabase
      .from("blog_posts")
      .select("id, title, slug, excerpt, category, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false });

    if (error) {
      console.error(LOG_PREFIX, error.message);
      return { ok: false };
    }

    return {
      ok: true,
      posts: ((data ?? []) as PublishedPostRow[]).map(toSummary),
    };
  } catch (error) {
    console.error(LOG_PREFIX, error);
    return { ok: false };
  }
}
