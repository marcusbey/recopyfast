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
    highlight: "bg-sky-500/10",
  },
  {
    icon: Wand2,
    title: "AI that writes like you",
    description:
      "Get intelligent suggestions that match your brand voice. Improve headlines, fix grammar, or translate to 12+ languages with one click.",
    accent: "from-purple-500 to-pink-500",
    highlight: "bg-purple-500/10",
  },
  {
    icon: Users2,
    title: "Your whole team, empowered",
    description:
      "Marketing, product, support — everyone can update content without developer handoffs. Role-based permissions keep everything organized.",
    accent: "from-emerald-500 to-teal-500",
    highlight: "bg-emerald-500/10",
  },
  {
    icon: Globe2,
    title: "Works everywhere",
    description:
      "React, Vue, WordPress, Webflow, static HTML — it doesn't matter. One script tag works with any website technology.",
    accent: "from-orange-500 to-amber-500",
    highlight: "bg-orange-500/10",
  },
  {
    icon: History,
    title: "Never lose a word",
    description:
      "Every change is tracked with full version history. Made a mistake? Roll back to any previous version in seconds.",
    accent: "from-indigo-500 to-violet-500",
    highlight: "bg-indigo-500/10",
  },
  {
    icon: Shield,
    title: "Enterprise-grade security",
    description:
      "SOC 2 compliant with SSO, audit logs, and encrypted data. Your content is protected with the same security Fortune 500 companies trust.",
    accent: "from-slate-500 to-zinc-500",
    highlight: "bg-slate-500/10",
  },
];

export default function Benefits() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
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
                      <stop
                        offset="0%"
                        className={benefit.accent
                          .split(" ")[0]
                          .replace("from-", "text-")}
                        style={{ stopColor: "currentColor" }}
                      />
                      <stop
                        offset="100%"
                        className={benefit.accent
                          .split(" ")[1]
                          .replace("to-", "text-")}
                        style={{ stopColor: "currentColor" }}
                      />
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

        {/* Bottom highlight */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="mt-20 relative"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-sky-500 to-emerald-500 rounded-3xl blur-xl opacity-10" />
          <div className="relative bg-gradient-to-r from-sky-600 to-emerald-600 rounded-3xl p-12 text-center overflow-hidden">
            {/* Grid overlay */}
            <div
              className="absolute inset-0 opacity-5"
              style={{
                backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
                backgroundSize: "40px 40px",
              }}
            />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-3 mb-6">
                <div className="flex -space-x-3">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="w-10 h-10 rounded-full bg-white/20 border-2 border-white/30 flex items-center justify-center text-xs font-bold text-white"
                    >
                      {["JD", "SM", "AK", "RB"][i]}
                    </div>
                  ))}
                </div>
                <span className="text-white/70 text-sm">
                  +2,847 teams this month
                </span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                Join thousands of teams shipping faster
              </h3>
              <p className="text-white/70 max-w-xl mx-auto mb-8">
                From startups to Fortune 500 companies, teams choose ReCopyFast
                to take control of their website content.
              </p>

              <div className="flex flex-wrap justify-center gap-8 text-sm">
                <div className="text-center">
                  <div className="text-3xl font-bold text-white">10K+</div>
                  <div className="text-white/60">Websites powered</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-white">5M+</div>
                  <div className="text-white/60">Edits made</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-white">99.9%</div>
                  <div className="text-white/60">Uptime</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-white">&lt;50ms</div>
                  <div className="text-white/60">Response time</div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
