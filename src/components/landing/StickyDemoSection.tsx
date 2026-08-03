"use client";

import { useRef } from "react";
import { useScroll } from "framer-motion";
import InteractiveHero from "./InteractiveHero";

/**
 * The demo section, pinned while the reader scrolls through it.
 *
 * The track is taller than the viewport; the visible content is `sticky`
 * inside it. While the track is passing through the viewport, page scroll
 * progress (0→1 across the track) is fed to InteractiveHero, which maps it to
 * the demo site's internal scroll. The effect: the fake browser holds still,
 * the demo page scrolls to its bottom, and only then does the landing page
 * continue — without hijacking the wheel, because the pinning is plain CSS
 * `position: sticky` and the scroll itself never leaves the document.
 *
 * TRACK_HEIGHT sets the exchange rate: 300vh means roughly two viewport
 * heights of page scroll are spent inside the demo. Taller = slower, more
 * deliberate read of the demo page.
 */
export default function StickyDemoSection() {
  const trackRef = useRef<HTMLDivElement>(null);

  /* 0 when the track's top pins to the viewport top, 1 when its bottom
     reaches the viewport bottom — exactly the interval the section is stuck. */
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start start", "end end"],
  });

  return (
    /* Solid white, not glass: the demo sites are themselves full page designs
       with their own backgrounds, and showing sky between them made the
       section read as floating cards rather than as websites. */
    <section className="solid-sheet border-y border-slate-200/80">
      <div ref={trackRef} className="relative h-[300vh]">
        <div className="sticky top-0 flex h-svh flex-col overflow-hidden px-6 pt-20 pb-4">
          <div className="mx-auto mb-6 max-w-7xl shrink-0 text-center">
            <h2 className="mb-3 text-3xl font-bold text-slate-900 md:text-4xl">
              See It In Action
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-slate-600">
              Three real-looking customer sites, three different designers. Keep
              scrolling to browse each page — click any text or photograph to
              change it.
            </p>
          </div>

          {/* Breaks out of the page's 7xl measure: these are supposed to read
              as full websites, and boxing them into the article column was the
              main reason they did not. */}
          <div className="mx-auto min-h-0 w-full max-w-[104rem] flex-1">
            <InteractiveHero demoScrollProgress={scrollYProgress} fillHeight />
          </div>
        </div>
      </div>
    </section>
  );
}
