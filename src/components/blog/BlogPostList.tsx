"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, ArrowRight } from "lucide-react";
import { formatDate } from "@/lib/utils/format-date";
import type { PublishedPostSummary } from "@/lib/blog/published-posts";

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
    <>
      {/* Category Filter */}
      <div
        role="tablist"
        aria-label="Filter posts by category"
        className="flex flex-wrap justify-center gap-3 mb-12"
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
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-2 text-muted-foreground hover:bg-surface-3"
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>

      {/* Blog Posts Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
        {visiblePosts.map((post) => (
          <Card key={post.id} className="group">
            <CardHeader className="space-y-4">
              <div className="flex items-center">
                <Badge variant="secondary" className="text-xs">
                  {post.category}
                </Badge>
              </div>
              <CardTitle className="group-hover:text-primary transition-colors">
                {post.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {post.excerpt && (
                <p className="text-sm text-muted-foreground mb-4">
                  {post.excerpt}
                </p>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                  {post.publishedAt && (
                    <>
                      <Calendar className="h-3 w-3" />
                      <span>{formatDate(post.publishedAt)}</span>
                    </>
                  )}
                </div>
                <Link
                  href={`/blog/${post.slug}`}
                  className="text-primary hover:underline font-medium text-sm flex items-center"
                >
                  Read more
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {visiblePosts.length === 0 && (
        <p className="text-center text-muted-foreground py-12">
          No posts in {activeCategory} yet.
        </p>
      )}
    </>
  );
}
