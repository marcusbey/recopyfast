"use client";

import { Zap, Github, Mail, Rocket, Shield } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";

const footerLinks = {
  Product: [
    { name: "Features", href: "/#features" },
    { name: "Pricing", href: "/#pricing" },
    { name: "Demo", href: "/demo" },
    { name: "Compare tools", href: "/compare" },
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

export default function Footer() {
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  return (
    <footer className="bg-white border-t border-sky-100">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-12">
          {/* Brand Section */}
          <div className="md:col-span-2 lg:col-span-2">
            <div className="flex items-center space-x-3 mb-6">
              <div className="relative">
                <div className="w-10 h-10 bg-sky-600 rounded-xl flex items-center justify-center">
                  <Zap className="h-5 w-5 text-white" />
                </div>
              </div>
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
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
                  <feature.icon className="h-4 w-4 text-sky-500" />
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
                  className="w-11 h-11 bg-sky-50 rounded-xl flex items-center justify-center hover:bg-sky-100 transition-colors duration-200 border border-sky-100"
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
                {links.map((link, index) => (
                  <li key={index}>
                    {link.href.startsWith("http") ? (
                      <a
                        href={link.href}
                        className="text-slate-600 hover:text-slate-900 transition-colors duration-200 text-sm"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {link.name}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-slate-600 hover:text-slate-900 transition-colors duration-200 text-sm"
                      >
                        {link.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-sky-100 mt-16 pt-8 flex flex-col md:flex-row justify-between items-center">
          <div className="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-6 mb-4 md:mb-0">
            <p className="text-slate-500 text-sm">
              &copy; {year ?? "2025"} ReCopyFast. All rights reserved.
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
