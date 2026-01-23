"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { AuthModal } from "@/components/auth/AuthModal";
import { UserMenu } from "@/components/auth/UserMenu";
import { Zap, Menu, X } from "lucide-react";
import Link from "next/link";

export function Header() {
  const { user, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled
            ? "bg-white/70 backdrop-blur-xl border-b border-sky-100/50 shadow-sm"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                  isScrolled
                    ? "bg-gradient-to-br from-sky-500 to-emerald-500"
                    : "bg-white/20 backdrop-blur-sm border border-sky-200/50"
                }`}
              >
                <Zap
                  className={`w-5 h-5 ${isScrolled ? "text-white" : "text-sky-500"}`}
                />
              </div>
              <span
                className={`font-bold text-xl tracking-tight transition-colors ${
                  isScrolled ? "text-slate-900" : "text-slate-800"
                }`}
              >
                ReCopyFast
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-8">
              <a
                href="#features"
                className={`text-sm font-medium transition-colors ${
                  isScrolled
                    ? "text-slate-600 hover:text-slate-900"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Features
              </a>
              <a
                href="#pricing"
                className={`text-sm font-medium transition-colors ${
                  isScrolled
                    ? "text-slate-600 hover:text-slate-900"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Pricing
              </a>
              <Link
                href="/demo"
                className={`text-sm font-medium transition-colors ${
                  isScrolled
                    ? "text-slate-600 hover:text-slate-900"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Demo
              </Link>
              <Link
                href="/blog"
                className={`text-sm font-medium transition-colors ${
                  isScrolled
                    ? "text-slate-600 hover:text-slate-900"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Blog
              </Link>
            </nav>

            {/* Auth Section */}
            <div className="flex items-center gap-4">
              {loading ? (
                <div className="w-9 h-9 rounded-full bg-sky-100 animate-pulse" />
              ) : user ? (
                <UserMenu />
              ) : (
                <>
                  <button
                    onClick={() => setShowAuthModal(true)}
                    className="hidden sm:inline-flex text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    Sign in
                  </button>
                  <Button
                    onClick={() => setShowAuthModal(true)}
                    size="sm"
                    className="bg-sky-500 text-white hover:bg-sky-600 shadow-lg shadow-sky-500/20 transition-all"
                  >
                    Get started
                  </Button>
                </>
              )}

              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`md:hidden p-2 rounded-lg transition-colors ${
                  isScrolled
                    ? "text-slate-600 hover:bg-sky-50"
                    : "text-slate-700 hover:bg-white/50"
                }`}
              >
                {mobileMenuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-4 pb-4 border-t border-sky-100 pt-4">
              <nav className="flex flex-col gap-4">
                <a
                  href="#features"
                  className="text-slate-600 hover:text-slate-900 text-sm font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Features
                </a>
                <a
                  href="#pricing"
                  className="text-slate-600 hover:text-slate-900 text-sm font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Pricing
                </a>
                <Link
                  href="/demo"
                  className="text-slate-600 hover:text-slate-900 text-sm font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Demo
                </Link>
                <Link
                  href="/blog"
                  className="text-slate-600 hover:text-slate-900 text-sm font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Blog
                </Link>
              </nav>
            </div>
          )}
        </div>
      </header>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
