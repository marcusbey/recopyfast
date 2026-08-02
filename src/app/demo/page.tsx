"use client";

import ReCopyFastLoader from "@/components/demo/ReCopyFastLoader";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ArrowRight, MousePointer, Sparkles, RefreshCw } from "lucide-react";
import Link from "next/link";

export default function Demo() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white">
      <ReCopyFastLoader />
      <Header />

      <main className="pt-24 pb-16">
        <div className="container mx-auto px-4">
          {/* Demo Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-sky-200 bg-white/80 backdrop-blur-sm mb-6 shadow-sm">
              <MousePointer className="w-4 h-4 text-sky-500" />
              <span className="text-sm text-slate-600">Interactive Demo</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
              See ReCopyFast in Action
            </h1>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Click on any text element below to edit it in real-time.
              Experience how easy content management can be.
            </p>
          </div>

          {/* Demo Content - Simulated Website */}
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Simulated Header */}
            <header className="bg-gradient-to-r from-sky-500 to-sky-600 text-white p-8 rounded-2xl shadow-lg shadow-sky-500/20">
              <h1 className="text-3xl md:text-4xl font-bold mb-3">
                Demo Company Website
              </h1>
              <p className="text-lg text-sky-100">
                This is a demo site showing ReCopyFast in action
              </p>
            </header>

            {/* Hero Section */}
            <div className="bg-white p-8 rounded-2xl shadow-lg shadow-sky-100/50 border border-sky-100">
              <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
                Welcome to Our Amazing Product
              </h2>
              <p className="text-lg text-slate-600 mb-6 leading-relaxed">
                Transform your business with our innovative solutions. We
                provide cutting-edge technology that helps you stay ahead of the
                competition.
              </p>
              {/* No onClick on purpose. Everything inside this block is the
                  mock customer site the demo edits, and the widget's selector
                  includes `button` — so clicking this opens the inline editor.
                  Giving it a navigation handler would fight the editor. */}
              <button
                type="button"
                className="bg-gradient-to-r from-sky-500 to-emerald-500 hover:from-sky-600 hover:to-emerald-600 text-white px-6 py-3 rounded-full font-semibold shadow-lg shadow-sky-500/25 transition-all hover:scale-105"
              >
                Get Started Today
              </button>
            </div>

            {/* Features Section */}
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-2xl shadow-lg shadow-sky-100/50 border border-sky-100 hover:shadow-xl hover:shadow-sky-200/50 transition-shadow">
                <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center mb-4">
                  <Sparkles className="w-5 h-5 text-sky-500" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  Feature One
                </h3>
                <p className="text-slate-600">
                  Our first feature delivers incredible value by automating
                  complex processes and saving you time.
                </p>
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-lg shadow-sky-100/50 border border-sky-100 hover:shadow-xl hover:shadow-sky-200/50 transition-shadow">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center mb-4">
                  <RefreshCw className="w-5 h-5 text-emerald-500" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  Feature Two
                </h3>
                <p className="text-slate-600">
                  Experience seamless integration with your existing tools and
                  workflows for maximum productivity.
                </p>
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-lg shadow-sky-100/50 border border-sky-100 hover:shadow-xl hover:shadow-sky-200/50 transition-shadow">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center mb-4">
                  <ArrowRight className="w-5 h-5 text-amber-500" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  Feature Three
                </h3>
                <p className="text-slate-600">
                  Advanced analytics and reporting give you insights that drive
                  better business decisions.
                </p>
              </div>
            </div>

            {/* CTA Section */}
            <div className="bg-gradient-to-r from-sky-500 to-emerald-500 text-white p-8 rounded-2xl text-center shadow-lg shadow-sky-500/20">
              <h2 className="text-2xl font-bold mb-4">Ready to Get Started?</h2>
              <p className="text-lg mb-6 text-sky-100">
                Join thousands of satisfied customers who have transformed their
                business with our platform.
              </p>
              {/* Sample copy inside the mock site — editable by the widget,
                  deliberately not a real CTA. The real one is below the fold. */}
              <button
                type="button"
                className="bg-white text-sky-600 px-8 py-3 rounded-full font-semibold hover:bg-sky-50 transition-colors shadow-lg"
              >
                Start Your Free Trial
              </button>
            </div>

            {/* Simulated Footer */}
            <footer className="bg-slate-800 text-white p-6 rounded-2xl text-center">
              <p className="text-slate-300">
                &copy; 2025 Demo Company. All rights reserved.
              </p>
            </footer>
          </div>

          {/* Instructions */}
          <div className="max-w-5xl mx-auto mt-12 bg-sky-50 border border-sky-200 rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-sky-900 mb-4 flex items-center gap-2">
              <MousePointer className="w-5 h-5 text-sky-500" />
              How to Test the Demo
            </h3>
            <ol className="grid md:grid-cols-2 gap-4 text-sky-800">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0">
                  1
                </span>
                <span>Click on any text element above to edit it</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0">
                  2
                </span>
                <span>Make changes and they will be saved automatically</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0">
                  3
                </span>
                <span>Open multiple browser windows to see real-time sync</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0">
                  4
                </span>
                <span>Check the browser console for ReCopyFast logs</span>
              </li>
            </ol>
          </div>

          {/* CTA to sign up */}
          <div className="text-center mt-12">
            <p className="text-slate-600 mb-4">
              Ready to add this to your own website?
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-8 py-4 bg-sky-500 text-white font-semibold rounded-full hover:bg-sky-600 transition-all hover:scale-105 shadow-lg shadow-sky-500/25"
            >
              Get Started Free
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
