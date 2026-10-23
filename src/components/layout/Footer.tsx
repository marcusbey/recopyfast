"use client";

import { Zap, Github, Mail, Rocket, Shield } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { openCookieSettings } from "@/lib/analytics/google-analytics/cookie-settings";
import { getDocumentPathname } from "@/lib/analytics/google-analytics/document-path";
import { getMeasurementId } from "@/lib/analytics/google-analytics/measurement-id";
import { isAnalyticsPage } from "@/lib/analytics/google-analytics/routes";

const footerLinks = {
  Product: [
    { name: "Product overview", href: "/product" },
    { name: "For business owners", href: "/for/owners" },
    { name: "Features", href: "/#features" },
    { name: "Installation guide", href: "/docs/install" },
    { name: "Pricing", href: "/#pricing" },
    { name: "Demo", href: "/demo" },
    { name: "Try your site", href: "/try" },
    { name: "Compare tools", href: "/compare" },
    { name: "Free tools", href: "/tools" },
  ],
  Company: [
    { name: "Blog", href: "/blog" },
    { name: "GitHub", href: "https://github.com/marcusbey/recopyfast" },
  ],
  Legal: [
    { name: "Privacy Policy", href: "/privacy" },
    { name: "Terms of Service", href: "/terms" },
  ],
};

/*
  s50 removed or corrected every claim below, each one false on production
  (owner decision 2026-09-28):

  - The email link went to hello@recopyfast.com. recopyfast.com is an
    unregistered domain (NXDOMAIN): the mail bounced, and whoever registers the
    domain receives every message a customer sends. support@recopyfa.st is the
    customer mailbox.
  - "Transform any website into an intelligent content management platform":
    a site whose Content Security Policy blocks the script cannot run it, and
    there is no content model to manage.
  - "All systems operational" with a pulsing green dot was hardcoded, with no
    check behind it, and would have stayed green through an outage. There is no
    status page (/status returns 404).
  - "v1.0.0" matched nothing: package.json says 0.1.0 and nothing versions
    releases.
  - "Comprehensive docs" pointed at no docs: /docs returns 404. "Secure &
    lightweight" became "Secure by default", because the widget is over its own
    gzip budget.
*/
const socialLinks = [
  {
    icon: Github,
    href: "https://github.com/marcusbey/recopyfast",
    label: "GitHub",
  },
  {
    icon: Mail,
    href: "mailto:support@recopyfa.st",
    label: "Email",
  },
];

const quickFeatures = [
  { icon: Rocket, text: "One-line integration" },
  { icon: Shield, text: "Secure by default" },
];

export default function Footer({
  variant = "default",
}: {
  variant?: "default" | "editorial";
}) {
  const pathname = usePathname();
  const [year, setYear] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const isEditorial = variant === "editorial";
  // s107: "Cookie settings" reopens the analytics consent banner, so it exists
  // only where the banner can: GA configured, and this page and the document
  // it lives in both on the allowlist — not on a free-tool report, nor on a
  // marketing page reached by a client navigation from an app page
  // (independent review F5). After mount only: the document's path is
  // unknown on the server, and the server HTML must match the first render.
  const hasCookieSettings =
    isMounted &&
    getMeasurementId() !== null &&
    isAnalyticsPage(pathname, getDocumentPathname());
  const marketingAnchorRoot = pathname === "/product" ? "/product" : "/";

  useEffect(() => {
    setYear(new Date().getFullYear());
    setIsMounted(true);
  }, []);

  return (
    <footer
      className={
        isEditorial
          ? "border-t border-[#d9d3c6] bg-[#ebe7dc]"
          : "border-t border-sky-100 bg-white"
      }
    >
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-12">
          {/* Brand Section */}
          <div className="md:col-span-2 lg:col-span-2">
            <div className="flex items-center space-x-3 mb-6">
              <div className="relative">
                <div
                  className={`flex h-10 w-10 items-center justify-center ${isEditorial ? "rounded-[3px] bg-[#287f7c]" : "rounded-xl bg-sky-600"}`}
                >
                  <Zap className="h-5 w-5 text-white" />
                </div>
              </div>
              <span
                className={`text-2xl tracking-tight ${isEditorial ? "font-serif font-medium text-[#142024]" : "font-semibold text-slate-900"}`}
              >
                ReCopyFast
              </span>
            </div>

            <p className="text-slate-600 mb-8 max-w-md leading-relaxed">
              Make the copy on the site you already built editable, with one
              script tag. No backend changes, no migration.
            </p>

            {/* Quick Features */}
            <div className="space-y-3 mb-8">
              {quickFeatures.map((feature, index) => (
                <div key={index} className="flex items-center space-x-3">
                  <feature.icon
                    className={`h-4 w-4 ${isEditorial ? "text-[#287f7c]" : "text-sky-500"}`}
                  />
                  <span className="text-slate-600 text-sm">{feature.text}</span>
                </div>
              ))}
            </div>

            {/* Social Links */}
            <div className="flex space-x-3">
              {socialLinks.map((social, index) => (
                <a
                  key={index}
                  href={social.href}
                  className={`flex h-11 w-11 items-center justify-center border transition-colors duration-200 ${isEditorial ? "rounded-[3px] border-[#d9d3c6] bg-transparent hover:bg-[#f7f3e9]" : "rounded-xl border-sky-100 bg-sky-50 hover:bg-sky-100"}`}
                  aria-label={social.label}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <social.icon className="h-5 w-5 text-slate-600" />
                </a>
              ))}
            </div>
          </div>

          {/* Link Sections */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category} className="lg:col-span-1">
              <h3 className="text-sm font-semibold mb-6 text-slate-900 uppercase tracking-[0.075em]">
                {category}
              </h3>
              <ul className="space-y-4">
                {links.map((link, index) => {
                  const href =
                    link.href === "/#features"
                      ? `${marketingAnchorRoot}#features`
                      : link.href === "/#pricing"
                        ? `${marketingAnchorRoot}#pricing`
                        : link.href;
                  return (
                    <li key={index}>
                      {href.startsWith("http") ? (
                        <a
                          href={href}
                          className="text-slate-600 hover:text-slate-900 transition-colors duration-200 text-sm"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {link.name}
                        </a>
                      ) : (
                        <Link
                          href={href}
                          className="text-slate-600 hover:text-slate-900 transition-colors duration-200 text-sm"
                        >
                          {link.name}
                        </Link>
                      )}
                    </li>
                  );
                })}
                {category === "Legal" && hasCookieSettings ? (
                  <li>
                    <button
                      type="button"
                      onClick={openCookieSettings}
                      className="text-slate-600 hover:text-slate-900 transition-colors duration-200 text-sm"
                    >
                      Cookie settings
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div
          className={`mt-16 flex flex-col items-center justify-between border-t pt-8 md:flex-row ${isEditorial ? "border-[#d9d3c6]" : "border-sky-100"}`}
        >
          <div className="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-6 mb-4 md:mb-0">
            <p className="text-slate-500 text-sm">
              &copy; {year ?? "2026"} ReCopyFast. All rights reserved.
            </p>
            <span className="text-slate-400 text-sm">
              Made with care for content teams
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
