"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import {
  MousePointerClick,
  Globe2,
  Users2,
  Wand2,
  History,
  Shield,
} from "lucide-react";

const benefits = [
  {
    icon: MousePointerClick,
    title: "Click. Edit. Done.",
    description:
      "No login dashboards, no complex interfaces. Just click any text on your live website and start typing. Changes go live instantly.",
    accent: "from-sky-500 to-cyan-500",
    stops: ["#0ea5e9", "#06b6d4"] as const,
    highlight: "bg-sky-500/10",
  },
  {
    icon: Wand2,
    title: "AI that writes like you",
    description:
      "Get intelligent suggestions that match your brand voice. Improve headlines, fix grammar, or translate to 12+ languages with one click.",
    accent: "from-purple-500 to-pink-500",
    stops: ["#a855f7", "#ec4899"] as const,
    highlight: "bg-purple-500/10",
  },
  {
    icon: Users2,
    title: "Your whole team, empowered",
    description:
      "Marketing, product, support — everyone can update content without developer handoffs. Role-based permissions keep everything organized.",
    accent: "from-emerald-500 to-teal-500",
    stops: ["#10b981", "#14b8a6"] as const,
    highlight: "bg-emerald-500/10",
  },
  {
    icon: Globe2,
    title: "Works everywhere",
    description:
      "React, Vue, WordPress, Webflow, static HTML — it doesn't matter. One script tag works with any website technology.",
    accent: "from-orange-500 to-amber-500",
    stops: ["#f97316", "#f59e0b"] as const,
    highlight: "bg-orange-500/10",
  },
  {
    icon: History,
    title: "Never lose a word",
    description:
      "Every change is tracked with full version history. Made a mistake? Roll back to any previous version in seconds.",
    accent: "from-indigo-500 to-violet-500",
    stops: ["#6366f1", "#8b5cf6"] as const,
    highlight: "bg-indigo-500/10",
  },
  {
    icon: Shield,
    title: "Secure by default",
    description:
      "Scoped API keys, per-site permissions, and encrypted content in transit and at rest. Every edit is attributed and logged.",
    accent: "from-slate-500 to-zinc-500",
    stops: ["#64748b", "#71717a"] as const,
    highlight: "bg-slate-500/10",
  },
];

export default function Benefits() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      // Header.tsx (twice) and Footer.tsx link to "#features", but no element
      // in the app carried that id — all three "Features" links were dead.
      // This is the features section, so it takes the anchor, matching how
      // Pricing.tsx:66 already carries id="pricing".
      id="features"
      className="py-32 px-6 bg-white/60 backdrop-blur-sm relative overflow-hidden"
    >
      {/* Decorative elements */}
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-sky-200 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-sky-200 to-transparent" />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-20"
        >
          <span className="inline-block px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-sky-600 bg-sky-50 rounded-full mb-6">
            Why teams love it
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-slate-900 tracking-tight mb-6">
            Built for speed,
            <br />
            <span className="bg-gradient-to-r from-sky-500 to-emerald-500 bg-clip-text text-transparent">
              designed for everyone
            </span>
          </h2>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto">
            Everything you need to manage website content without touching code
          </p>
        </motion.div>

        {/* Benefits grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {benefits.map((benefit, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.1 * i }}
              className="group relative bg-white rounded-3xl p-8 border border-sky-100 hover:border-sky-200 transition-all duration-300 hover:shadow-xl hover:shadow-sky-100/50"
            >
              {/* Icon */}
              <div
                className={`w-14 h-14 rounded-2xl ${benefit.highlight} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}
              >
                <benefit.icon
                  className={`w-7 h-7 bg-gradient-to-br ${benefit.accent} bg-clip-text`}
                  style={{
                    stroke: `url(#gradient-${i})`,
                  }}
                />
                <svg width="0" height="0">
                  <defs>
                    <linearGradient
                      id={`gradient-${i}`}
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      {/*
                        These stops used to build their class names at runtime
                        from `accent` (e.g. "from-cyan-500" -> "text-cyan-500").
                        Tailwind v4 extracts class names by scanning source
                        text, so a name assembled at runtime is never emitted —
                        7 of the 12 required utilities existed nowhere in the
                        stylesheet. stopColor then fell through to
                        `currentColor`, so most icons rendered the same flat
                        colour and card 5 (indigo->violet) had neither stop.
                        Literal colour values cannot be purged.
                      */}
                      <stop offset="0%" stopColor={benefit.stops[0]} />
                      <stop offset="100%" stopColor={benefit.stops[1]} />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              {/* Content */}
              <h3 className="text-xl font-bold text-slate-900 mb-3">
                {benefit.title}
              </h3>
              <p className="text-slate-600 leading-relaxed">
                {benefit.description}
              </p>

              {/* Hover accent line */}
              <div
                className={`absolute bottom-0 left-8 right-8 h-0.5 bg-gradient-to-r ${benefit.accent} transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 rounded-full`}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
