import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Link from "next/link";
import { ArrowRight, Newspaper } from "lucide-react";
import { BlogPostList } from "@/components/blog/BlogPostList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  listPublishedPosts,
  type PublishedPostsResult,
} from "@/lib/blog/published-posts";
import styles from "@/components/marketing/editorial-content.module.css";

// Until s88 /blog inherited the root layout's canonical, which named the
// homepage. Every indexable page names itself.
export const metadata: Metadata = {
  alternates: { canonical: "/blog" },
};

/**
 * Regenerated at most hourly, like the sitemap, which lists the same posts.
 *
 * The posts are read as `anon` (ADR 058), so nothing here depends on who asked
 * and the page can be static. Without `revalidate` it would be built once per
 * deploy, and a post an admin publishes afterwards would never appear.
 */
export const revalidate = 3600;

/**
 * The three states of the index, each its own component (design system §
 * States). Until s88's review this page rendered a hard-coded list of three
 * posts from January 2024 whose slugs no `blog_posts` row was known to have.
 */
function BlogPosts({ result }: { result: PublishedPostsResult }) {
  if (!result.ok) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-2xl">
        <AlertTitle>The blog could not be loaded</AlertTitle>
        <AlertDescription>
          Posts are temporarily unavailable. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  if (result.posts.length === 0) {
    return (
      <EmptyState
        icon={Newspaper}
        title="No posts yet"
        description="Nothing has been published here yet. The installation guide shows how ReCopyFast fits your site."
        action={
          <Button asChild variant="outline">
            <Link href="/docs/install">Read the installation guide</Link>
          </Button>
        }
      />
    );
  }

  return <BlogPostList posts={result.posts} />;
}

export default async function Blog() {
  const result = await listPublishedPosts();

  return (
    <div className={styles.page}>
      <Header variant="editorial" />

      <main className={styles.main}>
        <header className={`${styles.frame} ${styles.intro}`}>
          <p className={styles.eyebrow}>Field notes</p>
          <h1 className={styles.displayTitle}>
            Practical notes for handing over websites
          </h1>
          <p className={styles.lede}>
            Client edits, maintenance, and clearer responsibility after launch.
          </p>
        </header>

        <section className={`${styles.frame} ${styles.blogBody}`}>
          <BlogPosts result={result} />

          {/* Newsletter CTA
            The email capture form that used to live here had no onChange, no
            onSubmit and no endpoint — every address typed into it was silently
            discarded. There is no subscriber store in this codebase, so it is
            replaced with a CTA that goes somewhere real. */}
          <div className={styles.indexCta}>
            <h2 className={styles.featureTitle}>
              Start editing your site in minutes
            </h2>
            <p className={styles.closeBody}>
              Drop one script tag into any site and make its copy editable — no
              migration, no rebuild.
            </p>
            {/* Static marketing -> nonce app: this must replace the document. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/signup"
              data-cta-location="blog_index"
              className={styles.primaryAction}
            >
              Get started free
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </div>
        </section>
      </main>

      <Footer variant="editorial" />
    </div>
  );
}
