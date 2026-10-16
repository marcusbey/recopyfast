"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/utils/format-date";
import type { PublishedPostSummary } from "@/lib/blog/published-posts";
import styles from "@/components/marketing/editorial-content.module.css";

interface BlogPostListProps {
  posts: PublishedPostSummary[];
}

const ALL_CATEGORIES = "All";

export function BlogPostList({ posts }: BlogPostListProps) {
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES);

  // Categories are derived from the posts rather than hard-coded, so a filter
  // pill can never lead to an empty page.
  const categories = useMemo(
    () => [ALL_CATEGORIES, ...new Set(posts.map((post) => post.category))],
    [posts],
  );

  const visiblePosts = useMemo(
    () =>
      activeCategory === ALL_CATEGORIES
        ? posts
        : posts.filter((post) => post.category === activeCategory),
    [posts, activeCategory],
  );

  return (
    <div className={styles.blogGrid}>
      <aside aria-label="Browse blog categories">
        <h2 className={styles.browseLabel}>Browse</h2>
        <div
          role="tablist"
          aria-label="Filter posts by category"
          className={styles.categoryTabs}
        >
          {categories.map((category) => {
            const isActive = category === activeCategory;
            return (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveCategory(category)}
                className={`${styles.categoryTab} ${isActive ? styles.categoryTabActive : ""}`}
              >
                {category}
              </button>
            );
          })}
        </div>
      </aside>

      <div className={styles.postList}>
        {visiblePosts.map((post) => (
          <article key={post.id} className={styles.postRow}>
            <p className={styles.meta}>
              <span>{post.category}</span>
              {post.publishedAt && (
                <>
                  <span aria-hidden="true"> · </span>
                  <time dateTime={post.publishedAt}>
                    {formatDate(post.publishedAt)}
                  </time>
                </>
              )}
            </p>
            <h2 className={styles.postTitle}>{post.title}</h2>
            {post.excerpt && <p className={styles.excerpt}>{post.excerpt}</p>}
            <Link href={`/blog/${post.slug}`} className={styles.postLink}>
              Read article →
            </Link>
          </article>
        ))}

        {visiblePosts.length === 0 && (
          <p className={styles.excerpt}>No posts in {activeCategory} yet.</p>
        )}
      </div>
    </div>
  );
}
