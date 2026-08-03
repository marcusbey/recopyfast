"use client";

import { useState, useEffect, useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";

const editableWords = [
  "headline",
  "description",
  "button text",
  "testimonial",
  "pricing",
  "any text",
];

export default function Hero() {
  const [currentWord, setCurrentWord] = useState(0);
  const [isTyping, setIsTyping] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  });

  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsTyping(false);
      setTimeout(() => {
        setCurrentWord((prev) => (prev + 1) % editableWords.length);
        setIsTyping(true);
      }, 200);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <section
      ref={containerRef}
      /* SkyBackground observes this id to decide whether the raymarched sky is
         worth running. Renaming it silently drops the page to the cheap sky. */
      id="hero"
      className="relative flex min-h-[100vh] items-center justify-center overflow-hidden bg-transparent"
    >
      <motion.div
        className="relative z-10 mx-auto max-w-7xl px-6 py-32 text-center"
        style={{ opacity }}
      >
        {/* No pane, no border. The bordered glass sheet made the headline read
            as content inside a card; the headline should BE the hero. What
            replaces the pane's contrast work: a borderless radial wash that
            lifts the sky just enough behind the type, plus a display weight
            heavy enough that no drifting cloud can break its silhouette. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-[130%] -translate-y-1/2 [background:radial-gradient(58%_52%_at_50%_50%,rgba(255,255,255,0.5),rgba(255,255,255,0.18)_58%,transparent_78%)]"
        />

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="font-display mb-10 text-[3.4rem] font-extrabold leading-[0.92] tracking-[-0.035em] text-slate-900 sm:text-8xl lg:text-[8.5rem]"
        >
          <span className="block">Change your</span>
          <span className="relative mt-4 block">
            {/* Rendered as a field mid-edit rather than as gradient text. The
                product's whole claim is that copy is directly editable, so the
                hero demonstrates it instead of decorating it — and it lets the
                sky→emerald gradient that appeared on five sections go away. */}
            <span className="relative inline-flex min-w-[240px] items-center justify-center rounded-2xl bg-white/70 px-5 py-1 text-left ring-2 ring-sky-500/70 sm:min-w-[420px] lg:min-w-[620px]">
              <span
                className={`text-sky-700 transition-opacity duration-200 ${
                  isTyping ? "opacity-100" : "opacity-0"
                }`}
              >
                {editableWords[currentWord]}
              </span>
              <span
                aria-hidden="true"
                className="ml-1 inline-block h-[0.85em] w-[3px] animate-pulse bg-sky-600"
              />
            </span>
          </span>
          <span className="mt-4 block text-slate-900/45">in seconds.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="mx-auto mb-12 max-w-2xl text-lg leading-relaxed text-slate-800 sm:text-xl"
        >
          Stop waiting days for simple text updates. Add one line of code and
          give your team{" "}
          <span className="font-semibold text-slate-900">instant control</span>{" "}
          over every word on your website.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="flex flex-col items-center justify-center gap-4 sm:flex-row"
        >
          <Link
            href="/signup"
            className="pressable group inline-flex items-center gap-2 rounded-full bg-sky-600 px-8 py-4 font-semibold text-white transition-colors hover:bg-sky-700"
          >
            <span>Start editing for free</span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Link>

          <Link
            href="/demo"
            className="group inline-flex items-center gap-2 px-6 py-4 font-medium text-slate-700 transition-colors hover:text-slate-900"
          >
            <span className="glass flex h-10 w-10 items-center justify-center rounded-full">
              <Play className="ml-0.5 h-4 w-4 text-sky-600" />
            </span>
            <span>Watch it work</span>
          </Link>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="glass flex h-10 w-6 items-start justify-center rounded-full p-2"
        >
          <div className="h-2 w-1 rounded-full bg-white" />
        </motion.div>
      </motion.div>
    </section>
  );
}
