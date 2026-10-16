import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { sanitizeHTML } from "@/lib/security/content-sanitizer";
import { formatDate } from "@/lib/utils/format-date";
import styles from "@/components/marketing/editorial-content.module.css";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  category: string;
  published_at: string;
  created_at: string;
}

async function getBlogPost(slug: string): Promise<BlogPost | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

/**
 * Each post is its own canonical. Until s88 every post inherited the root
 * layout's canonical — the homepage — so search engines were told each article
 * was a duplicate of it. The slug alone names the URL, so this reads nothing;
 * an unknown slug still ends in `notFound()` below, whose response is noindex.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { alternates: { canonical: `/blog/${slug}` } };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getBlogPost(slug);

  if (!post) {
    notFound();
  }

  const readTime =
    Math.ceil(post.content.split(" ").length / 200) + " min read";

  return (
    <div className={styles.page}>
      <Header variant="editorial" />

      <main className={styles.main}>
        <header className={`${styles.frame} ${styles.articleMasthead}`}>
          <Link href="/blog" className={styles.backLink}>
            ← Back to blog
          </Link>

          <p className={styles.eyebrow}>{post.category}</p>

          <h1 className={styles.displayTitle}>{post.title}</h1>

          {post.excerpt && <p className={styles.lede}>{post.excerpt}</p>}
          <p className={styles.articleMeta}>
            <span>{formatDate(post.published_at)}</span>
            <span>{readTime}</span>
          </p>
        </header>

        <article className={`${styles.frame} ${styles.articleBody}`}>
          <div
            dangerouslySetInnerHTML={{
              __html: sanitizeHTML(
                post.content.replace(/\n/g, "<br />"),
                "RICH_TEXT",
              ),
            }}
          />
        </article>

        <section className={`${styles.frame} ${styles.articleClose}`}>
          <h2 className={styles.featureTitle}>Try the editing experience</h2>
          <p className={styles.closeBody}>
            Edit a sample website in your browser before deciding whether it
            fits your handoff.
          </p>
          <div className={styles.actionRow}>
            <Link href="/demo" className={styles.primaryAction}>
              Try the demo
            </Link>
            <Link href="/#features" className={styles.secondaryAction}>
              Learn more
            </Link>
          </div>
        </section>
      </main>

      <Footer variant="editorial" />
    </div>
  );
}
