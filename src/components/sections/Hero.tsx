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
        className="relative z-10 mx-auto max-w-5xl px-6 py-32"
        style={{ opacity }}
      >
        {/* The copy sits on frosted glass rather than directly on the sky. It
            has to: white clouds drift behind this text continuously, so any
            fixed text colour is unreadable against some frame of the animation.
            The pane fixes the contrast and is the one surface on the page where
            the sky is close enough to read through properly. */}
        <div className="glass-sheet rounded-[2rem] border border-white/50 px-8 py-14 text-center sm:px-14 sm:py-16">
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="mb-8 text-5xl font-bold leading-[0.95] tracking-tight text-slate-900 sm:text-6xl md:text-7xl"
          >
            <span className="block">Change your</span>
            <span className="relative mt-3 block">
              {/* Rendered as a field mid-edit rather than as gradient text. The
                  product's whole claim is that copy is directly editable, so the
                  hero demonstrates it instead of decorating it — and it lets the
                  sky→emerald gradient that appeared on five sections go away. */}
              <span className="relative inline-flex min-w-[220px] items-center justify-center rounded-xl bg-white/70 px-4 py-1 text-left ring-2 ring-sky-500/70 sm:min-w-[320px]">
                <span
                  className={`text-sky-700 transition-opacity duration-200 ${
                    isTyping ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {editableWords[currentWord]}
                </span>
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-[0.85em] w-[2px] animate-pulse bg-sky-600"
                />
              </span>
            </span>
            <span className="mt-3 block text-slate-500">in seconds.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="mx-auto mb-12 max-w-2xl text-lg font-light leading-relaxed text-slate-700 sm:text-xl"
          >
            Stop waiting days for simple text updates. Add one line of code and
            give your team{" "}
            <span className="font-normal text-slate-900">instant control</span>{" "}
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
        </div>
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
