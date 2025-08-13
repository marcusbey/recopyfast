import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';

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
    .from('blog_posts')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

export default async function BlogPostPage({ 
  params 
}: { 
  params: { slug: string } 
}) {
  const post = await getBlogPost(params.slug);

  if (!post) {
    notFound();
  }

  const readTime = Math.ceil(post.content.split(' ').length / 200) + ' min read';

  return (
    <div className="min-h-screen bg-white">
      <Header />
      
      <main className="max-w-4xl mx-auto px-6 py-16">
        {/* Back to Blog */}
        <Link 
          href="/blog"
          className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-8 group"
        >
          <ArrowLeft className="h-4 w-4 mr-2 group-hover:-translate-x-1 transition-transform" />
          Back to Blog
        </Link>

        {/* Article Header */}
        <header className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <Badge variant="secondary" className="text-sm">
              {post.category}
            </Badge>
            <div className="flex items-center text-gray-500 text-sm">
              <Calendar className="h-4 w-4 mr-2" />
              {new Date(post.published_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </div>
            <div className="flex items-center text-gray-500 text-sm">
              <Clock className="h-4 w-4 mr-2" />
              {readTime}
            </div>
          </div>
          
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight">
            {post.title}
          </h1>
          
          {post.excerpt && (
            <p className="text-xl text-gray-600 leading-relaxed">
              {post.excerpt}
            </p>
          )}
        </header>

        {/* Article Content */}
        <article className="prose prose-lg max-w-none">
          <div 
            dangerouslySetInnerHTML={{ 
              __html: post.content.replace(/\n/g, '<br />') 
            }} 
          />
        </article>

        {/* Article Footer */}
        <footer className="mt-16 pt-8 border-t border-gray-200">
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-8">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">
              Ready to transform your website?
            </h3>
            <p className="text-gray-600 mb-6">
              Try ReCopyFast today and see how easy it is to make any website editable 
              with just one line of code.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link 
                href="/demo"
                className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
              >
                Try Demo
              </Link>
              <Link 
                href="/#features"
                className="inline-flex items-center px-6 py-3 border border-blue-600 text-blue-600 rounded-lg font-semibold hover:bg-blue-50 transition-colors"
              >
                Learn More
              </Link>
            </div>
          </div>
        </footer>
      </main>

      <Footer />
    </div>
  );
}