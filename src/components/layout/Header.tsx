"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { AuthModal } from "@/components/auth/AuthModal";
import { UserMenu } from "@/components/auth/UserMenu";
import { Zap, Menu, X } from "lucide-react";
import Link from "next/link";

/* Past this many pixels the header takes on its solid, bordered state. */
const SCROLLED_THRESHOLD_PX = 50;

export function Header() {
  const { user, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    let frame = 0;

    /* Reading scrollY inside the scroll event forces the browser to flush
       pending layout synchronously, once per event. Deferring the read to the
       next animation frame collapses a burst of those into one read per frame.

       That read is clean in practice, but not by guarantee: rAF runs before
       style and layout for its frame, so it is only clean while nothing earlier
       in the frame has dirtied the DOM — and React can commit before rAF in the
       same frame. What makes it hold here is that scrolling this page barely
       touches React at all. Progress is published to a module store rather than
       state (see useLenis), and this handler writes the same boolean on every
       frame but the two either side of the threshold, so React bails without
       committing. Measured: 34ms of forced reflow attributed to this handler
       over a 5s scroll, now none detected.

       So this is the place to look if that number comes back. Reintroducing
       per-frame React work during scroll would make the read dirty again
       without changing a line of this file. */
    const readScroll = () => {
      frame = 0;
      setIsScrolled(window.scrollY > SCROLLED_THRESHOLD_PX);
    };

    const handleScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(readScroll);
    };

    /* The page can load already scrolled — restored position, or a #hash. */
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled ? "glass-sheet border-b border-white/40" : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                  isScrolled ? "bg-sky-600" : "glass"
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
              <Link
                href="/#features"
                className={`text-sm font-medium transition-colors ${
                  isScrolled
                    ? "text-slate-600 hover:text-slate-900"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Features
              </Link>
              <Link
                href="/#pricing"
                className={`text-sm font-medium transition-colors ${
                  isScrolled
                    ? "text-slate-600 hover:text-slate-900"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Pricing
              </Link>
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
                    className="pressable bg-sky-600 text-white hover:bg-sky-700"
                  >
                    Get started
                  </Button>
                </>
              )}

              {/* Mobile menu button */}
              <button
                type="button"
                aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-menu"
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
            <div
              id="mobile-menu"
              className="md:hidden mt-4 pb-4 border-t border-sky-100 pt-4"
            >
              <nav className="flex flex-col gap-4">
                <Link
                  href="/#features"
                  className="text-slate-600 hover:text-slate-900 text-sm font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Features
                </Link>
                <Link
                  href="/#pricing"
                  className="text-slate-600 hover:text-slate-900 text-sm font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Pricing
                </Link>
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
