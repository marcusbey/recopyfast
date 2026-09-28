"use client";

import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Play, Rocket } from "lucide-react";
import Link from "next/link";
import type { FoundingOfferView } from "@/hooks/useFoundingOffer";
import { foundingOfferHeadline } from "./founding-offer-copy";

const editableWords = [
  "headline",
  "description",
  "button text",
  "testimonial",
  "pricing",
  "any text",
];

/**
 * The announcement pill above the headline: the founding offer while spots
 * remain, the 14-day trial once they are gone or the count is unknown (s47b).
 *
 * Loading is an empty placeholder, not a link — an empty link is an unlabelled
 * focus stop — and it promises neither grant, so the server-rendered first
 * paint never says one thing that hydration then takes back.
 */
function FoundingOfferPill({ offer }: { offer: FoundingOfferView }) {
  if (offer.status === "loading") {
    return (
      <div
        aria-hidden="true"
        className="glass h-[38px] w-[17rem] animate-pulse rounded-full motion-reduce:animate-none md:w-[22rem]"
      />
    );
  }

  const { full, short } = pillLines(offer);

  return (
    <a
      href="#pricing"
      className="glass inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm text-slate-800"
    >
      <Rocket className="h-4 w-4 text-teal-700" />
      {/* The full line is about 580 px wide and does not fit a phone. */}
      <span className="hidden md:inline">{full}</span>
      <span className="md:hidden">{short}</span>
    </a>
  );
}

function pillLines(offer: Exclude<FoundingOfferView, { status: "loading" }>): {
  full: ReactNode;
  short: ReactNode;
} {
  if (offer.status === "closed") {
    return {
      full: "Every new account gets 14 days of Pro, free",
      short: "14 days of Pro, free",
    };
  }

  const isLastSpot = offer.remaining === 1;
  const count = (text: string) => (
    <span className="tabular font-semibold text-teal-800">{text}</span>
  );
  return {
    full: (
      <>
        {foundingOfferHeadline(offer.limit)} ·{" "}
        {count(
          isLastSpot
            ? "Last spot left"
            : `${offer.remaining} of ${offer.limit} spots left`,
        )}
      </>
    ),
    short: (
      <>
        Pro free for 3 months ·{" "}
        {count(
          isLastSpot
            ? "Last spot left"
            : `${offer.remaining} of ${offer.limit} left`,
        )}
      </>
    ),
  };
}

export default function Hero({ offer }: { offer: FoundingOfferView }) {
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
        /* The bottom padding is the demo window's share of the fold. The copy
           centres in what is left above it, so shrinking the type and raising
           the window are one change, not two that have to be kept in sync. */
        className="relative z-10 mx-auto max-w-7xl px-6 pt-20 pb-[32vh] text-center sm:pb-[40vh]"
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

        {/* A fixed-height slot, so the headline does not move when the count
            arrives. It enters with the headline; its contents swap with no
            motion of their own. */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="mb-6 flex h-[38px] justify-center"
        >
          <FoundingOfferPill offer={offer} />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          /* ~60% of what it was. The headline was sized to carry the fold on
             its own; it now shares the fold with the demo, and the demo is the
             better argument. */
          className="font-display mb-6 text-[2.05rem] font-extrabold leading-[0.94] tracking-[-0.035em] text-slate-900 sm:text-[3.6rem] lg:text-[5.1rem]"
        >
          <span className="block">Change your</span>
          <span className="relative mt-4 block">
            {/* Rendered as a field mid-edit rather than as gradient text. The
                product's whole claim is that copy is directly editable, so the
                hero demonstrates it instead of decorating it — and it lets the
                sky→emerald gradient that appeared on five sections go away. */}
            <span className="relative inline-flex min-w-[150px] items-center justify-center rounded-xl bg-white/70 px-4 py-0.5 text-left ring-2 ring-sky-500/70 sm:min-w-[260px] lg:min-w-[380px]">
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
          className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-slate-800 sm:text-lg"
        >
          Stop waiting days for simple text updates. Add one line of code and
          give your team{" "}
          <span className="font-semibold text-slate-900">direct control</span>{" "}
          over the words on your website.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="flex flex-col items-center justify-center gap-4 sm:flex-row"
        >
          {/*
            This said "Get started", because the label before it — "Start
            editing for free" — was untrue: `free` is retired and resolves to no
            entitlement, so an account was worth nothing until a paid plan was
            on it. It is a trial, not a free plan, that makes a free-sounding
            CTA honest, and there is now one: Pro granted at sign-in with no
            card (src/lib/billing/trial.ts). The first `limit` accounts get 90
            days of it instead of 14 (s47a's founding offer); either way it is
            a free trial. Hence "Start your free trial", which names the thing
            that actually happens.

            It still names no price. The catalogue is fetched live in
            Pricing.tsx, and a number hardcoded here would be a second source of
            truth free to drift from it — which is exactly how Stripe ended up
            describing Pro as 3 sites.
          */}
          <Link
            href="/signup"
            className="pressable group inline-flex items-center gap-2 rounded-full bg-sky-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-sky-700"
          >
            <span>Start your free trial</span>
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

        {/* This line used to name the 14 days. The pill above the headline now
            carries the part that varies with the founding-offer count (s47b);
            this line says only what is true under both grants. */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-4 text-sm text-slate-600"
        >
          No credit card required.
        </motion.p>
      </motion.div>

      {/* The bouncing scroll cue that used to sit here is gone: the demo window
          now rises into the bottom of this section and lands on top of it, and
          a browser window half in frame says "there is more below" better than
          a mouse glyph did — while also being the thing you scroll to reach. */}
    </section>
  );
}
