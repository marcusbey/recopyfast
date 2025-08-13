'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Copy, Check, ChevronRight, Sparkles } from 'lucide-react';
import InteractiveHero from '@/components/landing/InteractiveHero';

export default function EnhancedHero() {
  const [copied, setCopied] = useState(false);
  const [typedText, setTypedText] = useState('');
  const scriptTag = `<script src="https://cdn.recopyfast.com/embed/recopyfast.js"
        data-site-id="your-site-id"></script>`;

  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      if (i < scriptTag.length) {
        setTypedText(scriptTag.substring(0, i + 1));
        i++;
      } else {
        clearInterval(timer);
      }
    }, 50);

    return () => clearInterval(timer);
  }, []);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(scriptTag);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="pt-24 pb-20 bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-4xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100 text-blue-700 text-sm font-medium mb-8">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
            Transform any website in under 5 minutes
          </div>

          {/* Main Headline */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 leading-tight">
            Transform Any Website Into an{' '}
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Editable Platform
            </span>
          </h1>

          {/* Subheading */}
          <p className="text-xl text-gray-600 mb-10 max-w-3xl mx-auto leading-relaxed">
            Add a single script tag to make your website content editable with AI assistance. 
            No backend changes required. Perfect for quick prototypes and instant content management.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-4">
              Start Free Trial
              <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
            <Button variant="outline" size="lg" className="text-lg px-8 py-4 border-gray-300 hover:bg-gray-50">
              <Play className="mr-2 h-5 w-5" />
              View Live Demo
            </Button>
          </div>

          {/* Interactive Demo Section - Full Width */}
        </div>
      </div>
      
      {/* Full Width Interactive Demo with Gradient Background */}
      <div className="relative py-16 mb-16 overflow-hidden">
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 opacity-10"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-white/50 via-transparent to-white/50"></div>
        
        {/* Decorative Elements */}
        <div className="absolute top-10 left-10 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 right-10 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-full blur-3xl"></div>
        
        <div className="relative z-10 max-w-[140%] mx-auto px-4 sm:px-6 lg:px-8 transform scale-110">
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-16 shadow-2xl border border-white/50">
            <div className="flex items-center justify-between mb-16">
              <div className="flex items-center space-x-4">
                <div className="w-14 h-14 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                  <Sparkles className="w-7 h-7 text-white" />
                </div>
                <h3 className="text-3xl font-bold text-gray-900">Try it yourself - Click any text below!</h3>
              </div>
              <div className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-base font-medium rounded-full shadow-lg">
                <span className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
                  Live Demo
                </span>
              </div>
            </div>
            
            {/* Our existing interactive demo */}
            <InteractiveHero />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-4xl mx-auto">

          {/* Code Demo */}
          <div className="max-w-4xl mx-auto">
            <div className="bg-gray-900 rounded-xl p-6 text-left shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                </div>
                <button
                  onClick={copyToClipboard}
                  className="flex items-center space-x-2 text-gray-400 hover:text-white transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span className="text-sm">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      <span className="text-sm">Copy</span>
                    </>
                  )}
                </button>
              </div>
              <div className="font-mono text-sm">
                <div className="text-green-400">{typedText}</div>
                <div className="mt-2 text-gray-400 text-xs">
                  That&apos;s it! Your website becomes instantly editable.
                </div>
              </div>
            </div>
            
            {/* Before/After Preview */}
            <div className="grid md:grid-cols-2 gap-8 mt-12">
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h3 className="text-sm font-semibold text-gray-500 mb-3 uppercase tracking-wide">Before</h3>
                <div className="space-y-3">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
                <p className="text-sm text-gray-500 mt-4">Static content, developer required for changes</p>
              </div>
              
              <div className="bg-white rounded-lg shadow-lg p-6 border-2 border-green-200">
                <h3 className="text-sm font-semibold text-green-600 mb-3 uppercase tracking-wide">After</h3>
                <div className="space-y-3">
                  <div className="h-4 bg-gradient-to-r from-blue-200 to-purple-200 rounded cursor-pointer hover:from-blue-300 hover:to-purple-300 transition-colors"></div>
                  <div className="h-4 bg-gradient-to-r from-blue-200 to-purple-200 rounded w-3/4 cursor-pointer hover:from-blue-300 hover:to-purple-300 transition-colors"></div>
                  <div className="h-4 bg-gradient-to-r from-blue-200 to-purple-200 rounded w-1/2 cursor-pointer hover:from-blue-300 hover:to-purple-300 transition-colors"></div>
                </div>
                <p className="text-sm text-green-600 mt-4">✨ Click to edit, AI-powered suggestions</p>
              </div>
            </div>

            {/* Trust indicators */}
            <div className="flex justify-center items-center space-x-8 mt-12 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span>Live on 10,000+ websites</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span>99.9% uptime</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                <span>&lt;100ms response time</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}