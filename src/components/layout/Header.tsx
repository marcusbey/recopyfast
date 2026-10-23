"use client";

import { useState, useEffect } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/auth/UserMenu";
import { Zap, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { dataFastCtaAttributes } from "@/lib/analytics/datafast-goals";

/* Past this many pixels the header takes on its solid, bordered state. */
const SCROLLED_THRESHOLD_PX = 50;

export function Header({
  variant = "default",
}: {
  variant?: "default" | "editorial";
}) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isEditorial = variant === "editorial";
  const isMarketingDocument = pathname === "/" || pathname === "/product";
  const marketingAnchorRoot = pathname === "/product" ? "/product" : "/";

  const scrollToMarketingSection = (
    event: ReactMouseEvent<HTMLAnchorElement>,
    id: "pricing",
  ) => {
    if (!isMarketingDocument) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    window.history.pushState(null, "", `#${id}`);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
          isEditorial
            ? isScrolled
              ? "border-b border-[#d9d3c6] bg-[#f7f3e9]/95 backdrop-blur"
              : "bg-[#f7f3e9]/85 backdrop-blur-sm"
            : isScrolled
              ? "glass-sheet border-b border-white/40"
              : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 flex items-center justify-center transition-all ${
                  isEditorial
                    ? "rounded-[3px] bg-[#287f7c]"
                    : `rounded-xl ${isScrolled ? "bg-sky-600" : "glass"}`
                }`}
              >
                <Zap
                  className={`w-5 h-5 ${isEditorial || isScrolled ? "text-white" : "text-sky-500"}`}
                />
              </div>
              <span
                className={`text-xl tracking-tight transition-colors ${isEditorial ? "font-serif text-[#142024]" : `font-semibold ${isScrolled ? "text-slate-900" : "text-slate-800"}`}`}
              >
                ReCopyFast
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-8">
              <Link
                href="/demo"
                {...dataFastCtaAttributes("header", "demo")}
                className={`text-sm font-medium transition-colors ${
                  isScrolled
                    ? "text-slate-600 hover:text-slate-900"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Demo
              </Link>
              <Link
                href={`${marketingAnchorRoot}#pricing`}
                onClick={(event) => scrollToMarketingSection(event, "pricing")}
                className={`text-sm font-medium transition-colors ${
                  isScrolled
                    ? "text-slate-600 hover:text-slate-900"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Pricing
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
                  {/* ADR 059 is a document boundary. A client transition would
                      keep the marketing page's unsafe-inline policy on login. */}
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a
                    href="/login"
                    className="hidden sm:inline-flex text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    Sign in
                  </a>
                  <Button
                    asChild
                    size="sm"
                    className={`pressable text-white ${isEditorial ? "rounded-[3px] bg-[#287f7c] hover:bg-[#206d6a]" : "bg-sky-600 hover:bg-sky-700"}`}
                  >
                    {/* The native anchor also keeps modifier keys and ordinary
                        link accessibility at this security boundary. */}
                    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                    <a
                      href="/signup"
                      data-cta-location="header"
                      {...dataFastCtaAttributes("header", "signup")}
                    >
                      Get started
                    </a>
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
                  href="/demo"
                  {...dataFastCtaAttributes("header_mobile", "demo")}
                  className="text-slate-600 hover:text-slate-900 text-sm font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Demo
                </Link>
                <Link
                  href={`${marketingAnchorRoot}#pricing`}
                  onClick={(event) => {
                    scrollToMarketingSection(event, "pricing");
                    setMobileMenuOpen(false);
                  }}
                  className="text-slate-600 hover:text-slate-900 text-sm font-medium"
                >
                  Pricing
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
    </>
  );
}
