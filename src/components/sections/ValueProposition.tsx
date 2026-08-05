"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Clock, DollarSign, Frown, ArrowRight } from "lucide-react";

const painPoints = [
  {
    icon: Clock,
    stat: "Days",
    label: "Waiting on a dev to change one word",
    color: "text-red-500",
  },
  {
    icon: DollarSign,
    stat: "Dev hours",
    label: "Spent on one-line copy edits",
    color: "text-red-500",
  },
  {
    icon: Frown,
    stat: "Redeploy",
    label: "Required for every text tweak",
    color: "text-red-500",
  },
];

const benefits = [
  {
    stat: "1 line",
    label: "Of code to install",
    color: "text-sky-700",
  },
  {
    stat: "$0",
    label: "Developer cost per update",
    color: "text-sky-700",
  },
  {
    // Was "Changes go live instantly", which described a real-time pipeline
    // this product no longer has: the embed's establishConnection() returns
    // early because no websocket endpoint is configured, and a visitor picks
    // up published copy from GET /api/content/:siteId as the page loads. The
    // claim worth making is the one being contrasted — no redeploy, no CI
    // wait, no developer — not a latency figure we cannot hold to.
    stat: "No deploy",
    label: "Live on the next page load",
    color: "text-sky-700",
  },
];

export default function ValueProposition() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      className="glass-sheet relative overflow-hidden border-y border-white/40 py-24 sm:py-32 px-6"
    >
      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-20"
        >
          <span className="mb-6 inline-block text-sm font-semibold uppercase tracking-[0.075em] text-sky-700">
            The problem
          </span>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 mb-6">
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
          <p className="text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto">
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
              <span className="text-sm font-semibold text-red-500 uppercase tracking-[0.075em]">
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
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-600">
              <ArrowRight className="h-7 w-7 rotate-90 text-white lg:rotate-0" />
            </div>
          </motion.div>

          {/* After */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="space-y-6"
          >
            <div className="text-center lg:text-left mb-8">
              <span className="text-sm font-semibold text-sky-700 uppercase tracking-[0.075em]">
                With ReCopyFast
              </span>
            </div>
            {benefits.map((benefit, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.5 + i * 0.1 }}
                className="flex items-center gap-5 p-5 bg-sky-50/50 rounded-2xl border border-sky-100"
              >
                <div className="w-12 h-12 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg font-bold text-sky-700">✓</span>
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
            Content updates go from a{" "}
            <span className="line-through text-red-400">ticket</span> to a{" "}
            <span className="text-sky-700 font-bold">click</span>.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
