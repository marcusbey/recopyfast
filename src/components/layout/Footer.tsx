"use client";

import { Zap, Github, Mail, Rocket, Shield, BookOpen } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";

const footerLinks = {
  Product: [
    { name: "Features", href: "/#features" },
    { name: "Pricing", href: "/#pricing" },
    { name: "Demo", href: "/demo" },
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

const socialLinks = [
  {
    icon: Github,
    href: "https://github.com/marcusbey/recopyfast",
    label: "GitHub",
  },
  {
    icon: Mail,
    href: "mailto:hello@recopyfast.com",
    label: "Email",
  },
];

const quickFeatures = [
  { icon: Rocket, text: "One-line integration" },
  { icon: Shield, text: "Secure & lightweight" },
  { icon: BookOpen, text: "Comprehensive docs" },
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
                <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/20">
                  <Zap className="h-5 w-5 text-white" />
                </div>
              </div>
              <span className="text-2xl font-bold tracking-tight text-slate-900">
                ReCopyFast
              </span>
            </div>

            <p className="text-slate-600 mb-8 max-w-md leading-relaxed">
              Transform any website into an intelligent content management
              platform with a single script tag. No backend changes required.
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
              <h3 className="text-sm font-semibold mb-6 text-slate-900 uppercase tracking-wider">
                {category}
              </h3>
              <ul className="space-y-4">
                {links.map((link, index) => (
                  <li key={index}>
                    {link.href.startsWith("http") ? (
                      <a
                        href={link.href}
                        className="text-slate-600 hover:text-sky-600 transition-colors duration-200 text-sm"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {link.name}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-slate-600 hover:text-sky-600 transition-colors duration-200 text-sm"
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

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-slate-500">All systems operational</span>
            </div>
            <div className="text-xs text-slate-400 bg-sky-50 px-3 py-1 rounded-full border border-sky-100">
              v1.0.0
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
