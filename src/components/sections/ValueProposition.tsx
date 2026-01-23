"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Clock, DollarSign, Frown, ArrowRight, Sparkles } from "lucide-react";

const painPoints = [
  {
    icon: Clock,
    stat: "72 hours",
    label: "Average wait for a text change",
    color: "text-red-500",
  },
  {
    icon: DollarSign,
    stat: "$500+",
    label: "Cost per minor content update",
    color: "text-red-500",
  },
  {
    icon: Frown,
    stat: "87%",
    label: "Teams frustrated by slow updates",
    color: "text-red-500",
  },
];

const benefits = [
  {
    stat: "< 5 min",
    label: "Setup time",
    color: "text-emerald-500",
  },
  {
    stat: "$0",
    label: "Developer cost per update",
    color: "text-emerald-500",
  },
  {
    stat: "100%",
    label: "Team satisfaction",
    color: "text-emerald-500",
  },
];

export default function ValueProposition() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      className="py-32 px-6 bg-white/80 backdrop-blur-sm relative overflow-hidden"
    >
      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-20"
        >
          <span className="inline-block px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-orange-600 bg-orange-50 rounded-full mb-6">
            The Problem
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-slate-900 tracking-tight mb-6">
            Your website copy is{" "}
            <span className="relative">
              <span className="relative z-10">trapped</span>
              <svg
                className="absolute -bottom-2 left-0 w-full h-3 text-red-200"
                viewBox="0 0 200 12"
                preserveAspectRatio="none"
              >
                <path
                  d="M0,6 Q50,0 100,6 T200,6"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
              </svg>
            </span>
          </h2>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Every typo fix, every A/B test, every campaign update requires a
            developer ticket and days of waiting.
          </p>
        </motion.div>

        {/* Pain points → Benefits transformation */}
        <div className="grid lg:grid-cols-[1fr,auto,1fr] gap-8 lg:gap-4 items-center">
          {/* Before */}
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="space-y-6"
          >
            <div className="text-center lg:text-left mb-8">
              <span className="text-sm font-semibold text-red-500 uppercase tracking-wider">
                Without ReCopyFast
              </span>
            </div>
            {painPoints.map((point, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.3 + i * 0.1 }}
                className="flex items-center gap-5 p-5 bg-red-50/50 rounded-2xl border border-red-100"
              >
                <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                  <point.icon className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">
                    {point.stat}
                  </div>
                  <div className="text-sm text-slate-500">{point.label}</div>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* Arrow */}
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={isInView ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="flex justify-center lg:flex-col items-center gap-2"
          >
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-sky-500/25">
              <ArrowRight className="w-7 h-7 text-white rotate-90 lg:rotate-0" />
            </div>
            <Sparkles className="w-5 h-5 text-sky-500 animate-pulse" />
          </motion.div>

          {/* After */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="space-y-6"
          >
            <div className="text-center lg:text-left mb-8">
              <span className="text-sm font-semibold text-emerald-500 uppercase tracking-wider">
                With ReCopyFast
              </span>
            </div>
            {benefits.map((benefit, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.5 + i * 0.1 }}
                className="flex items-center gap-5 p-5 bg-emerald-50/50 rounded-2xl border border-emerald-100"
              >
                <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg font-bold text-emerald-600">✓</span>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">
                    {benefit.stat}
                  </div>
                  <div className="text-sm text-slate-500">{benefit.label}</div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Bottom statement */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="mt-24 text-center"
        >
          <p className="text-2xl sm:text-3xl text-slate-900 font-medium max-w-3xl mx-auto leading-relaxed">
            &ldquo;We cut our content update time from{" "}
            <span className="line-through text-red-400">3 days</span> to{" "}
            <span className="text-emerald-500 font-bold">3 minutes</span>
            &rdquo;
          </p>
          <p className="mt-4 text-slate-500">
            — Sarah Chen, Head of Marketing at TechCorp
          </p>
        </motion.div>
      </div>
    </section>
  );
}
