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
      className="relative min-h-[100vh] flex items-center justify-center overflow-hidden bg-transparent"
    >
      <motion.div
        className="relative z-10 max-w-6xl mx-auto px-6 py-32 text-center"
        style={{ opacity }}
      >
        {/* Main headline */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight text-slate-900 mb-8 leading-[0.95]"
        >
          <span className="block">Change your</span>
          <span className="block mt-2 relative">
            <span
              className={`inline-block min-w-[200px] sm:min-w-[280px] text-left bg-gradient-to-r from-sky-500 via-sky-400 to-emerald-400 bg-clip-text text-transparent transition-opacity duration-200 ${isTyping ? "opacity-100" : "opacity-0"}`}
            >
              {editableWords[currentWord]}
            </span>
          </span>
          <span className="block mt-2 text-slate-400">in seconds.</span>
        </motion.h1>

        {/* Subheadline - Value focused */}
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="text-lg sm:text-xl md:text-2xl text-slate-600 max-w-3xl mx-auto mb-12 leading-relaxed font-light"
        >
          Stop waiting days for simple text updates. Add one line of code and
          give your team{" "}
          <span className="text-slate-900 font-normal">instant control</span>{" "}
          over every word on your website.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            href="/signup"
            className="group relative inline-flex items-center gap-2 px-8 py-4 bg-sky-500 text-white font-semibold rounded-full overflow-hidden transition-all hover:bg-sky-600 hover:scale-105 shadow-lg shadow-sky-500/25"
          >
            <span className="relative z-10">Start editing for free</span>
            <ArrowRight className="relative z-10 w-5 h-5 transition-transform group-hover:translate-x-1" />
          </Link>

          <Link
            href="/demo"
            className="group inline-flex items-center gap-2 px-8 py-4 text-slate-600 font-medium hover:text-slate-900 transition-colors"
          >
            <div className="w-10 h-10 rounded-full border border-slate-200 bg-white/80 flex items-center justify-center group-hover:border-sky-300 group-hover:bg-sky-50 transition-colors shadow-sm">
              <Play className="w-4 h-4 ml-0.5 text-sky-500" />
            </div>
            <span>Watch it work</span>
          </Link>
        </motion.div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-6 h-10 rounded-full border border-sky-200 bg-white/50 flex items-start justify-center p-2 backdrop-blur-sm"
        >
          <motion.div className="w-1 h-2 bg-sky-400 rounded-full" />
        </motion.div>
      </motion.div>
    </section>
  );
}
