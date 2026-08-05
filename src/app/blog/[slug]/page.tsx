import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { sanitizeHTML } from "@/lib/security/content-sanitizer";

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
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-4xl mx-auto px-6 py-16">
        {/* Back to Blog */}
        <Link
          href="/blog"
          className="inline-flex items-center text-primary hover:underline mb-8 group"
        >
          <ArrowLeft className="h-4 w-4 mr-2 group-hover:-translate-x-1 transition-transform" />
          Back to blog
        </Link>

        {/* Article Header */}
        <header className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <Badge variant="secondary" className="text-sm">
              {post.category}
            </Badge>
            <div className="flex items-center text-muted-foreground text-sm">
              <Calendar className="h-4 w-4 mr-2" />
              {new Date(post.published_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
            <div className="flex items-center text-muted-foreground text-sm">
              <Clock className="h-4 w-4 mr-2" />
              {readTime}
            </div>
          </div>

          <h1 className="text-display mb-6">{post.title}</h1>

          {post.excerpt && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {post.excerpt}
            </p>
          )}
        </header>

        {/* Article Content */}
        <article className="prose prose-lg max-w-none">
          <div
            dangerouslySetInnerHTML={{
              __html: sanitizeHTML(
                post.content.replace(/\n/g, "<br />"),
                "RICH_TEXT",
              ),
            }}
          />
        </article>

        {/* Article Footer */}
        <footer className="mt-16 pt-8 border-t border-border">
          <div className="bg-surface-1 rounded-xl p-8">
            <h3 className="text-xl font-semibold text-foreground mb-4">
              Ready to transform your website?
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Try ReCopyFast today and see how easy it is to make any website
              editable with just one line of code.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/demo"
                className="inline-flex items-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
              >
                Try demo
              </Link>
              <Link
                href="/#features"
                className="inline-flex items-center px-6 py-3 border border-input bg-card text-foreground rounded-lg font-medium hover:bg-accent transition-colors"
              >
                Learn more
              </Link>
            </div>
          </div>
        </footer>
      </main>

      <Footer />
    </div>
  );
}
