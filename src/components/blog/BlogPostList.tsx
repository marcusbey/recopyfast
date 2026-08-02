"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, ArrowRight } from "lucide-react";

export interface BlogPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  publishedAt: string;
  readTime: string;
  featured: boolean;
}

interface BlogPostListProps {
  posts: BlogPost[];
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

  const featured = visiblePosts.filter((post) => post.featured);
  const rest = visiblePosts.filter((post) => !post.featured);

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
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>

      {/* Featured Post */}
      {featured.map((post) => (
        <div key={post.id} className="mb-16">
          <div className="relative bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-8 md:p-12 text-white">
            <div className="max-w-4xl">
              <Badge
                variant="secondary"
                className="mb-4 bg-white/20 text-white border-white/30"
              >
                Featured
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                {post.title}
              </h2>
              <p className="text-xl text-blue-100 mb-6">{post.excerpt}</p>
              <div className="flex items-center space-x-6 mb-6">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4" />
                  <span>{new Date(post.publishedAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4" />
                  <span>{post.readTime}</span>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-white/20 text-white border-white/30"
                >
                  {post.category}
                </Badge>
              </div>
              <Link
                href={`/blog/${post.slug}`}
                className="inline-flex items-center px-6 py-3 bg-white text-blue-600 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
              >
                Read More
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
            <div className="absolute top-10 right-10 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
            <div className="absolute bottom-10 right-20 w-20 h-20 bg-white/10 rounded-full blur-xl"></div>
          </div>
        </div>
      ))}

      {/* Blog Posts Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
        {rest.map((post) => (
          <Card
            key={post.id}
            className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
          >
            <CardHeader className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-xs">
                  {post.category}
                </Badge>
                <div className="flex items-center space-x-2 text-sm text-gray-500">
                  <Clock className="h-3 w-3" />
                  <span>{post.readTime}</span>
                </div>
              </div>
              <CardTitle className="text-xl group-hover:text-blue-600 transition-colors">
                {post.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">{post.excerpt}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-sm text-gray-500">
                  <Calendar className="h-3 w-3" />
                  <span>{new Date(post.publishedAt).toLocaleDateString()}</span>
                </div>
                <Link
                  href={`/blog/${post.slug}`}
                  className="text-blue-600 hover:text-blue-800 font-medium text-sm flex items-center"
                >
                  Read More
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {visiblePosts.length === 0 && (
        <p className="text-center text-gray-600 py-12">
          No posts in {activeCategory} yet.
        </p>
      )}
    </>
  );
}
