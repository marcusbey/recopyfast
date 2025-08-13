import Link from "next/link";
import { ArrowRight, Code2, Globe, Zap } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Code2 className="h-8 w-8 text-blue-600" />
            <span className="text-xl font-bold">ReCopyFast</span>
          </div>
          <nav className="flex items-center space-x-6">
            <Link href="/docs" className="text-gray-600 hover:text-gray-900">
              Documentation
            </Link>
            <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
              Dashboard
            </Link>
            <Link 
              href="/auth/login"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center max-w-4xl mx-auto">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Transform Any Website Into an <span className="text-blue-600">Editable Platform</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Add a single script tag to make your website content editable. No backend changes required.
            Perfect for quick prototypes and content management.
          </p>
          <div className="flex justify-center space-x-4">
            <Link
              href="/auth/signup"
              className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition flex items-center space-x-2"
            >
              <span>Start Free Trial</span>
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/demo"
              className="border border-gray-300 px-8 py-3 rounded-lg hover:bg-gray-50 transition"
            >
              View Demo
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="text-center">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Code2 className="h-8 w-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">1. Add Script Tag</h3>
            <p className="text-gray-600">
              Simply add our lightweight script tag to your website's HTML
            </p>
          </div>
          <div className="text-center">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Globe className="h-8 w-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">2. Content Detection</h3>
            <p className="text-gray-600">
              ReCopyFast automatically detects and extracts editable content
            </p>
          </div>
          <div className="text-center">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Zap className="h-8 w-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">3. Edit in Real-time</h3>
            <p className="text-gray-600">
              Make changes through our dashboard and see them live instantly
            </p>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="bg-gray-900 text-white py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-8">Quick Integration</h2>
          <div className="max-w-3xl mx-auto">
            <div className="bg-gray-800 rounded-lg p-6 font-mono text-sm">
              <div className="text-gray-400 mb-2">{"<!-- Add before closing </body> tag -->"}</div>
              <div className="text-green-400">
                {'<script src="https://cdn.recopyfast.com/embed/recopyfast.js"'}
              </div>
              <div className="text-green-400 ml-8">
                {'data-site-id="your-site-id"></script>'}
              </div>
            </div>
            <p className="text-center mt-6 text-gray-300">
              That's it! Your website is now editable.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Features</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <div className="border rounded-lg p-6 hover:shadow-lg transition">
            <h3 className="text-xl font-semibold mb-3">Real-time Updates</h3>
            <p className="text-gray-600">
              Changes reflect instantly on your live website without page refresh
            </p>
          </div>
          <div className="border rounded-lg p-6 hover:shadow-lg transition">
            <h3 className="text-xl font-semibold mb-3">Multi-language Support</h3>
            <p className="text-gray-600">
              Manage content in multiple languages from a single dashboard
            </p>
          </div>
          <div className="border rounded-lg p-6 hover:shadow-lg transition">
            <h3 className="text-xl font-semibold mb-3">Version Control</h3>
            <p className="text-gray-600">
              Track changes and rollback to previous versions when needed
            </p>
          </div>
          <div className="border rounded-lg p-6 hover:shadow-lg transition">
            <h3 className="text-xl font-semibold mb-3">A/B Testing</h3>
            <p className="text-gray-600">
              Create content variants and test what works best for your audience
            </p>
          </div>
          <div className="border rounded-lg p-6 hover:shadow-lg transition">
            <h3 className="text-xl font-semibold mb-3">Team Collaboration</h3>
            <p className="text-gray-600">
              Invite team members with role-based permissions
            </p>
          </div>
          <div className="border rounded-lg p-6 hover:shadow-lg transition">
            <h3 className="text-xl font-semibold mb-3">Universal Compatibility</h3>
            <p className="text-gray-600">
              Works with any website regardless of the technology stack
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-blue-600 text-white py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
          <p className="text-xl mb-8">
            Transform your website into an editable platform in minutes
          </p>
          <Link
            href="/auth/signup"
            className="bg-white text-blue-600 px-8 py-3 rounded-lg hover:bg-gray-100 transition inline-flex items-center space-x-2"
          >
            <span>Start Free Trial</span>
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <Code2 className="h-6 w-6" />
              <span className="font-semibold">ReCopyFast</span>
            </div>
            <div className="flex space-x-6">
              <Link href="/privacy" className="hover:text-gray-300">Privacy</Link>
              <Link href="/terms" className="hover:text-gray-300">Terms</Link>
              <Link href="/docs" className="hover:text-gray-300">Docs</Link>
            </div>
          </div>
          <div className="mt-4 text-center text-gray-400 text-sm">
            © 2024 ReCopyFast. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}