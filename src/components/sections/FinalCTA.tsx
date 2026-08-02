"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { ArrowRight, Zap } from "lucide-react";
import Link from "next/link";

export default function FinalCTA() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      className="glass-sheet relative overflow-hidden border-t border-white/40 py-32 px-6"
    >
      <div className="max-w-4xl mx-auto relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.6 }}
          className="glass mb-8 inline-flex items-center gap-2 rounded-full px-4 py-2"
        >
          <Zap className="w-4 h-4 text-amber-500" />
          <span className="text-sm text-slate-600">
            Set up in under 5 minutes
          </span>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-slate-900 tracking-tight mb-6 leading-tight"
        >
          Ready to take control
          <br />
          <span className="text-sky-700">of your content?</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto mb-12"
        >
          Stop waiting on developers for every text change. Give your team the
          power to update website content instantly.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            href="/signup"
            className="pressable group inline-flex items-center gap-2 rounded-full bg-sky-600 px-10 py-5 text-lg font-semibold text-white transition-colors hover:bg-sky-700"
          >
            <span>Get started</span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Link>

          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-8 py-5 text-slate-600 hover:text-slate-900 font-medium transition-colors"
          >
            See it in action
            <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-16 flex flex-wrap justify-center items-center gap-6 text-sm text-slate-400"
        >
          {/*
            "No credit card required" and "14-day free trial" were removed:
            there is no trial_period_days anywhere and subscription Checkout
            always collects a card, so both were claims the product broke.
          */}
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
            Cancel anytime
          </span>
        </motion.div>
      </div>
    </section>
  );
}
