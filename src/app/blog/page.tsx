import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, ArrowRight } from "lucide-react";

// This would typically come from a database
const blogPosts = [
  {
    id: 1,
    title: "5 Ways AI Website Builders Are Revolutionizing Web Development",
    slug: "ai-website-builders-revolutionizing-web-development",
    excerpt: "Discover how AI-powered tools are making website creation faster and more accessible for freelancers, marketers, and developers.",
    category: "AI Tools",
    publishedAt: "2024-01-15",
    readTime: "5 min read",
    featured: true
  },
  {
    id: 2,
    title: "Why Every Marketer Needs Dynamic Content Management",
    slug: "dynamic-content-management-for-marketers",
    excerpt: "Learn how dynamic content updates can boost your conversion rates and improve user engagement without technical complexity.",
    category: "Marketing",
    publishedAt: "2024-01-14",
    readTime: "4 min read",
    featured: false
  },
  {
    id: 3,
    title: "The Freelancer's Guide to Client Website Management",
    slug: "freelancer-guide-client-website-management",
    excerpt: "Streamline your client workflow with tools that let you update content instantly without waiting for developer cycles.",
    category: "Freelancing",
    publishedAt: "2024-01-13",
    readTime: "6 min read",
    featured: false
  }
];

const categories = ["All", "AI Tools", "Marketing", "Freelancing", "Development", "Design"];

export default function Blog() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      
      <main className="max-w-7xl mx-auto px-6 py-16">
        {/* Blog Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            Blog
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Insights, tutorials, and stories for creators who build and manage websites with AI tools
          </p>
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap justify-center gap-3 mb-12">
          {categories.map((category) => (
            <button
              key={category}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                category === "All" 
                  ? "bg-blue-600 text-white" 
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Featured Post */}
        {blogPosts.filter(post => post.featured).map((post) => (
          <div key={post.id} className="mb-16">
            <div className="relative bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-8 md:p-12 text-white">
              <div className="max-w-4xl">
                <Badge variant="secondary" className="mb-4 bg-white/20 text-white border-white/30">
                  Featured
                </Badge>
                <h2 className="text-3xl md:text-4xl font-bold mb-4">{post.title}</h2>
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
                  <Badge variant="secondary" className="bg-white/20 text-white border-white/30">
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
          {blogPosts.filter(post => !post.featured).map((post) => (
            <Card key={post.id} className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
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

        {/* Load More */}
        <div className="text-center mt-12">
          <button className="px-8 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors">
            Load More Posts
          </button>
        </div>

        {/* Newsletter CTA */}
        <div className="mt-20 bg-gray-50 rounded-2xl p-8 md:p-12 text-center">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">
            Stay Updated with Our Latest Posts
          </h3>
          <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
            Get weekly insights on AI tools, web development, and content management delivered to your inbox.
          </p>
          <div className="max-w-md mx-auto flex gap-3">
            <input
              type="email"
              placeholder="Enter your email"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
              Subscribe
            </button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}