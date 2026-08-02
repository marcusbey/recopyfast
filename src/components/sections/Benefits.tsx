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
  Languages,
  FlaskConical,
} from "lucide-react";

/**
 * The two capabilities that are genuinely hard to copy, and that the page never
 * mentioned before this. Both are shipped: translation runs through
 * `POST /api/ai/translate` (batched, writes the translated strings straight back
 * to the content table), and the variant loop runs `POST /api/ab-tests/generate`
 * → the embed buckets each visitor → `POST /api/ab-tests/track` → the results
 * route scores it and a cron closes the test out.
 *
 * Every claim below traces to one of those routes. Nothing here is aspirational.
 */
const headline = [
  {
    icon: Languages,
    eyebrow: "Translate",
    title: "Every string on the site, in another language",
    description:
      "Pick a language and translate the whole site in one pass — not string by string. Translations are written back as real content, so they stay editable afterwards.",
  },
  {
    icon: FlaskConical,
    eyebrow: "Test",
    title: "Find out which words actually win",
    description:
      "Generate variants of a headline, split your traffic across them, and let the test call it. Views, clicks and conversions are attributed per variant, and the winner stays live on its own.",
    isSignal: true,
  },
];

const supporting = [
  {
    icon: MousePointerClick,
    title: "Click. Edit. Done.",
    description:
      "Click any text on your live site and type. No dashboard to learn.",
  },
  {
    icon: Wand2,
    title: "AI that writes like you",
    description:
      "Rewrite any string for a tone and a goal, without leaving the page.",
  },
  {
    icon: Users2,
    title: "Your whole team",
    description:
      "Role-based permissions, plus revocable edit access for contractors.",
  },
  {
    icon: Globe2,
    title: "Works everywhere",
    description: "React, Vue, WordPress, Webflow, static HTML. One script tag.",
  },
  {
    icon: History,
    title: "Never lose a word",
    description:
      "Full version history on every string. Roll back at any point.",
  },
  {
    icon: Shield,
    title: "Secure by default",
    description:
      "Scoped API keys, per-site permissions, and an audit log of every edit.",
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
      className="solid-sheet relative overflow-hidden border-y border-slate-200/80 py-32 px-6"
    >
      <div className="relative z-10 mx-auto max-w-6xl">
        {/* Left-aligned on purpose. Four sections above this one open with a
            centered eyebrow-over-headline-over-subhead stack; repeating it a
            fifth time is most of why the page read as a template. */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="mb-16 max-w-2xl"
        >
          <span className="text-eyebrow">Features</span>
          <h2 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Changing the words is the easy part
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-slate-700">
            Knowing which words to use is the hard part. ReCopyFast does both.
          </p>
        </motion.div>

        {/* The two differentiated capabilities, at twice the size of everything
            else. Deliberately unequal weighting — six identical cards told a
            visitor that all six mattered the same, which was never true. */}
        <div className="mb-20 grid gap-6 md:grid-cols-2">
          {headline.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 32 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.1 + i * 0.1 }}
              className="surface-interactive rounded-3xl border border-white/60 bg-white/70 p-9"
            >
              <div
                className={`mb-6 flex h-12 w-12 items-center justify-center rounded-2xl ${
                  item.isSignal ? "bg-emerald-600" : "bg-sky-600"
                }`}
              >
                <item.icon className="h-6 w-6 text-white" />
              </div>
              <span
                className={`text-eyebrow ${
                  item.isSignal ? "text-emerald-700" : "text-sky-700"
                }`}
              >
                {item.eyebrow}
              </span>
              <h3 className="mt-3 text-2xl font-bold leading-snug text-slate-900">
                {item.title}
              </h3>
              <p className="mt-4 leading-relaxed text-slate-700">
                {item.description}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Everything else, compressed. These are table stakes — real, worth
            listing, not worth a card each. */}
        <div className="grid gap-x-10 gap-y-9 border-t border-slate-900/10 pt-14 sm:grid-cols-2 lg:grid-cols-3">
          {supporting.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.06 }}
              className="flex gap-4"
            >
              <item.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-sky-700" />
              <div>
                <h3 className="font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {item.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
