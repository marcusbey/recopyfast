import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, Code, Globe, Users, Zap, Shield, ArrowRight, Play, Copy, Wand2, Sparkles } from "lucide-react"
import InteractiveHero from "@/components/landing/InteractiveHero"
import Link from "next/link"

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/95 backdrop-blur sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <Code className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl text-gray-900 tracking-tight">ReCopyFast</span>
          </div>
          <nav className="hidden md:flex items-center space-x-8">
            <a href="#features" className="text-gray-600 hover:text-gray-900 transition-colors font-medium">
              Features
            </a>
            <a href="#pricing" className="text-gray-600 hover:text-gray-900 transition-colors font-medium">
              Pricing
            </a>
            <Link href="/demo" className="text-gray-600 hover:text-gray-900 transition-colors font-medium">
              Live Demo
            </Link>
            <Button variant="outline" size="sm" className="border-gray-300 text-gray-700 hover:bg-gray-50">
              Sign In
            </Button>
          </nav>
        </div>
      </header>

      {/* Interactive Hero Section */}
      <section className="py-24 px-6 bg-gradient-to-b from-gray-50 to-white">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-20">
            <Badge variant="secondary" className="mb-8 bg-blue-50 text-blue-700 border-blue-200 mx-auto block w-fit shadow-sm">
              <Sparkles className="w-4 h-4 mr-2" />
              Universal CMS Layer with AI
            </Badge>
            <InteractiveHero />
          </div>

          {/* Quick Integration Steps */}
          <div className="max-w-5xl mx-auto mb-20">
            <h3 className="text-2xl font-bold text-gray-900 text-center mb-12">
              Three Steps to Transform Your Website
            </h3>
            <div className="grid md:grid-cols-3 gap-8 items-center">
              {/* Step 1 */}
              <div className="text-center group">
                <div className="bg-white rounded-2xl p-8 mb-4 border border-gray-200 shadow-sm group-hover:shadow-lg transition-all duration-300">
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-full flex items-center justify-center text-lg font-bold mb-4 mx-auto">
                    1
                  </div>
                  <div className="space-y-3">
                    <div className="h-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"></div>
                    <div className="h-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"></div>
                    <div className="h-2 bg-gradient-to-r from-pink-500 to-red-500 rounded-full"></div>
                  </div>
                  <p className="text-sm font-medium text-gray-700 mt-4">Copy Script</p>
                </div>
                <ArrowRight className="w-6 h-6 text-blue-500 mx-auto animate-pulse hidden md:block" />
              </div>

              {/* Step 2 */}
              <div className="text-center group">
                <div className="bg-white rounded-2xl p-6 mb-4 border border-gray-200 shadow-sm group-hover:shadow-lg transition-all duration-300">
                  <div className="bg-gray-900 text-white p-4 rounded-xl text-left font-mono text-xs">
                    <div className="text-green-400">&lt;script src=&quot;recopyfast.js&quot;</div>
                    <div className="text-blue-400 ml-4">data-site-id=&quot;123&quot;&gt;</div>
                  </div>
                  <p className="text-sm font-medium text-gray-700 mt-4">Paste & Configure</p>
                </div>
                <ArrowRight className="w-6 h-6 text-blue-500 mx-auto animate-pulse hidden md:block" />
              </div>

              {/* Step 3 */}
              <div className="text-center group">
                <div className="bg-white rounded-2xl p-8 mb-4 border border-gray-200 shadow-sm group-hover:shadow-lg transition-all duration-300">
                  <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-full flex items-center justify-center mb-4 mx-auto">
                    <CheckCircle className="w-6 h-6" />
                  </div>
                  <div className="text-lg font-semibold text-gray-900 mb-2">Ready!</div>
                  <div className="text-sm text-gray-600">Start Editing</div>
                </div>
              </div>
            </div>
          </div>

          {/* Integration Code Example */}
          <div className="bg-white border border-gray-200 rounded-2xl p-8 max-w-4xl mx-auto shadow-sm">
            <h3 className="font-bold text-2xl text-center mb-8 text-gray-900">Quick Integration Guide</h3>
            <div className="grid md:grid-cols-3 gap-8">
              {/* Step 1 */}
              <div className="text-center">
                <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Code className="w-6 h-6 text-white" />
                </div>
                <h4 className="font-semibold mb-2 text-gray-900">1. Add Script Tag</h4>
                <p className="text-sm text-gray-600">
                  Copy and paste our lightweight script into your website&apos;s HTML
                </p>
              </div>

              {/* Step 2 */}
              <div className="text-center">
                <div className="bg-gray-900 text-white p-4 rounded-xl mb-4 font-mono text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-green-400">script.js</span>
                    <Copy className="w-4 h-4" />
                  </div>
                  <div>recopyfast.com/embed.js</div>
                </div>
                <h4 className="font-semibold mb-2 text-gray-900">2. Copy, Paste, Done</h4>
                <p className="text-sm text-gray-600">Our script automatically detects editable content</p>
              </div>

              {/* Step 3 */}
              <div className="text-center">
                <div className="w-12 h-12 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-6 h-6 text-white" />
                </div>
                <h4 className="font-semibold mb-2 text-gray-900">3. Edit with AI</h4>
                <p className="text-sm text-gray-600">Make changes with AI assistance and see them live instantly</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 px-6 bg-gray-50">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="font-bold text-3xl md:text-4xl mb-4 text-gray-900">Powerful Features</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Everything you need to transform any website into an intelligent content management platform
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Zap,
                title: "Real-time Updates",
                description: "Changes reflect instantly without page refresh",
                color: "from-yellow-500 to-orange-500"
              },
              {
                icon: Wand2,
                title: "AI-Powered Suggestions",
                description: "Get intelligent content improvements with one click",
                color: "from-purple-500 to-pink-500"
              },
              {
                icon: Globe,
                title: "Universal Translation",
                description: "Translate entire websites to 12+ languages instantly",
                color: "from-blue-500 to-cyan-500"
              },
              {
                icon: Users,
                title: "Team Collaboration",
                description: "Multiple editors with role-based permissions",
                color: "from-green-500 to-emerald-500"
              },
              {
                icon: Shield,
                title: "Version Control",
                description: "Track changes and rollback when needed",
                color: "from-gray-500 to-slate-500"
              },
              {
                icon: CheckCircle,
                title: "A/B Testing",
                description: "Create content variants for testing",
                color: "from-indigo-500 to-purple-500"
              },
            ].map((feature, index) => (
              <Card key={index} className="group hover:shadow-lg transition-all hover:-translate-y-1 border border-gray-200 bg-white">
                <CardHeader>
                  <div className={`w-12 h-12 bg-gradient-to-r ${feature.color} rounded-xl flex items-center justify-center mb-4 shadow-lg`}>
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <CardTitle className="font-bold text-lg text-gray-900">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-gray-600">{feature.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-24 px-6 bg-white">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-16">
            <div className="bg-white border border-gray-200 rounded-2xl p-8 max-w-2xl mx-auto shadow-sm">
              <div className="flex items-start space-x-4">
                <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-lg">
                  S
                </div>
                <div className="text-left">
                  <p className="text-lg font-medium mb-4 text-gray-900">
                    &ldquo;ReCopyFast made content updates 10x faster! We were up and running in minutes, and the AI suggestions are incredible.&rdquo;
                  </p>
                  <div>
                    <p className="font-semibold text-gray-900">Sarah Chen</p>
                    <p className="text-sm text-gray-600">Marketing Director, TechCorp</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center">
            <p className="text-sm text-gray-600 mb-8">Trusted by innovative companies worldwide</p>
            <div className="flex flex-wrap justify-center items-center gap-8 opacity-60">
              {["TECHCORP", "INNOVATE", "WEBFLOW", "STARTUP", "AGENCY"].map((company, index) => (
                <div
                  key={index}
                  className="text-2xl font-bold text-gray-400 hover:text-gray-600 transition-colors cursor-default"
                >
                  {company}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-6 bg-gradient-to-r from-blue-600 to-purple-600 text-white relative overflow-hidden">
        <div className="container mx-auto max-w-4xl text-center relative z-10">
          <h2 className="font-bold text-3xl md:text-4xl mb-4">Ready to Transform Your Website?</h2>
          <p className="text-xl mb-8 text-blue-100">
            Join thousands of websites using ReCopyFast for intelligent content management
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" variant="secondary" className="px-8 py-3 text-lg bg-white text-gray-900 hover:bg-gray-100 font-semibold">
              Start Free Trial
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 py-3 text-lg border-white text-white hover:bg-white hover:text-blue-600 bg-transparent font-semibold"
            >
              <Play className="mr-2 w-5 h-5" />
              Schedule Demo
            </Button>
          </div>
        </div>
        
        {/* Decorative elements */}
        <div className="absolute top-10 left-10 w-20 h-20 bg-white/10 rounded-full blur-xl"></div>
        <div className="absolute bottom-10 right-10 w-32 h-32 bg-white/10 rounded-full blur-xl"></div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-gray-200 bg-white">
        <div className="container mx-auto max-w-6xl">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-3 mb-4 md:mb-0">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                <Code className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl text-gray-900 tracking-tight">ReCopyFast</span>
            </div>
            <div className="flex space-x-6 text-sm text-gray-600">
              <Link href="/docs" className="hover:text-gray-900 transition-colors font-medium">
                Documentation
              </Link>
              <Link href="/demo" className="hover:text-gray-900 transition-colors font-medium">
                Live Demo
              </Link>
              <Link href="#" className="hover:text-gray-900 transition-colors font-medium">
                Privacy
              </Link>
              <Link href="#" className="hover:text-gray-900 transition-colors font-medium">
                Terms
              </Link>
            </div>
          </div>
          <div className="text-center mt-8 text-sm text-gray-600">
            <p>© 2024 ReCopyFast. Empowering creators, one script at a time.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}