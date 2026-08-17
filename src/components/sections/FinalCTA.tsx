"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { ArrowRight, Zap } from "lucide-react";
import Link from "next/link";

export default function FinalCTA() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    /* No sheet here, deliberately. This is the one section whose background IS
       the sky, which by this point in the scroll has turned orange. Every text
       colour below is darkened to compensate: `.glass-sheet` was doing contrast
       work that nothing is doing now, and slate-600 body copy measures about
       2.4:1 against the sunset zenith. */
    <section
      ref={ref}
      className="relative overflow-hidden border-t border-white/30 py-24 sm:py-32 px-6"
    >
      <div className="max-w-6xl mx-auto relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.6 }}
          className="glass mb-8 inline-flex items-center gap-2 rounded-full px-4 py-2"
        >
          <Zap className="w-4 h-4 text-amber-500" />
          <span className="text-sm text-slate-800">
            Set up in under 5 minutes
          </span>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 mb-6"
        >
          Ready to take control
          <br />
          {/* Was sky-700. Blue on orange is the one pairing this sky cannot
              carry — complementary, so it vibrates at the edges and reads as a
              mistake. A deep warm brown belongs to the same family as the
              background and still measures over 5:1 against it. */}
          <span className="text-amber-950">of your content?</span>
        </motion.h2>

        {/* "update website content instantly" went the way of the trial copy
            further down: publishing is plain HTTP and the new copy reaches
            visitors on their next page load. What is genuinely immediate is
            who is allowed to make the change, so that is what this says. */}
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-lg sm:text-xl text-slate-800 leading-relaxed max-w-2xl mx-auto mb-12"
        >
          Stop waiting on developers for every text change. Give your team the
          power to update website copy without a deploy.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          {/* Near-black rather than sky blue: on a warm background the darkest
              thing on screen is the strongest call to action, and it does not
              fight the sky for attention the way a saturated blue would. */}
          <Link
            href="/signup"
            className="pressable group inline-flex items-center gap-2 rounded-full bg-slate-900 px-10 py-5 text-lg font-semibold text-white transition-colors hover:bg-slate-800"
          >
            <span>Get started</span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Link>

          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-8 py-5 text-slate-800 hover:text-slate-900 font-medium transition-colors"
          >
            See it in action
            <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-16 flex flex-wrap justify-center items-center gap-6 text-sm text-slate-800"
        >
          {/*
            These two were removed once, when there was no trial anywhere and
            subscription Checkout always collected a card — both were claims the
            product broke. They are true again because a new account is granted
            14 days of Pro at sign-in, with no Stripe customer and no card (see
            src/lib/billing/trial.ts). If that grant is ever removed, these go
            with it.
          */}
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
            14-day free trial
          </span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
            No credit card required
          </span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
            Cancel anytime
          </span>
        </motion.div>
      </div>
    </section>
  );
}
