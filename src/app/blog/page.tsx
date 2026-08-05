import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BlogPostList } from "@/components/blog/BlogPostList";

// This would typically come from a database
const blogPosts = [
  {
    id: 1,
    title: "5 Ways AI Website Builders Are Revolutionizing Web Development",
    slug: "ai-website-builders-revolutionizing-web-development",
    excerpt:
      "Discover how AI-powered tools are making website creation faster and more accessible for freelancers, marketers, and developers.",
    category: "AI Tools",
    publishedAt: "2024-01-15",
    readTime: "5 min read",
    featured: true,
  },
  {
    id: 2,
    title: "Why Every Marketer Needs Dynamic Content Management",
    slug: "dynamic-content-management-for-marketers",
    excerpt:
      "Learn how dynamic content updates can boost your conversion rates and improve user engagement without technical complexity.",
    category: "Marketing",
    publishedAt: "2024-01-14",
    readTime: "4 min read",
    featured: false,
  },
  {
    id: 3,
    title: "The Freelancer's Guide to Client Website Management",
    slug: "freelancer-guide-client-website-management",
    excerpt:
      "Streamline your client workflow with tools that let you update content instantly without waiting for developer cycles.",
    category: "Freelancing",
    publishedAt: "2024-01-13",
    readTime: "6 min read",
    featured: false,
  },
];

export default function Blog() {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-16">
        {/* Blog Header */}
        <div className="text-center mb-16">
          <h1 className="text-display mb-6">Blog</h1>
          <p className="text-sm text-muted-foreground max-w-3xl mx-auto">
            Insights, tutorials, and stories for creators who build and manage
            websites with AI tools
          </p>
        </div>

        <BlogPostList posts={blogPosts} />

        {/* Newsletter CTA
            The email capture form that used to live here had no onChange, no
            onSubmit and no endpoint — every address typed into it was silently
            discarded. There is no subscriber store in this codebase, so it is
            replaced with a CTA that goes somewhere real. */}
        <div className="mt-20 bg-surface-1 rounded-xl p-8 md:p-12 text-center">
          <h3 className="text-xl font-semibold text-foreground mb-4">
            Start editing your site in minutes
          </h3>
          <p className="text-sm text-muted-foreground mb-8 max-w-2xl mx-auto">
            Drop one script tag into any site and make its copy editable — no
            migration, no rebuild.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Get started free
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
