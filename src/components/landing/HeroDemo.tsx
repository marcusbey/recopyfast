"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import InteractiveHero from "./InteractiveHero";

/**
 * The demo, in the hero, pinned while the reader scrolls through it.
 *
 * Moved up from its own "See it in action" section further down the page. The
 * claim the hero makes — change the words on your site in seconds — used to be
 * asserted in type and then demonstrated two screens later; now the proof is
 * the thing under the headline, and there is only one demo on the page.
 *
 * THE MECHANICS, which are three stacked effects:
 *
 * 1. The window rises INTO the hero. The negative top margin pulls the track up
 *    so the window's top edge lands inside the hero's lower third at rest —
 *    peeking, the way a screenshot sits under a headline — instead of waiting a
 *    full viewport below the fold where nobody would find it.
 *
 * 2. It PINS, and page scroll becomes the demo's own scroll. The track is taller
 *    than the viewport and the window is `sticky` inside it, so the window holds
 *    still while `demoScroll` drives the demo site's internal scrollTop. No
 *    wheel hijacking: the pinning is plain CSS and the page never stops
 *    scrolling.
 *
 * 3. It RECEDES, and the problem section comes up behind it. Over the last
 *    stretch of the track the window scales back and lifts slightly, which
 *    uncovers the top of the section stacked underneath it (see page.tsx, where
 *    ValueProposition is pulled up under this one). Then the track ends, sticky
 *    releases, and the window scrolls away to reveal the rest of it.
 *
 * TRACK_HEIGHT sets the exchange rate: 320vh is a bit over two viewports of
 * page scroll spent inside the demo. Taller = slower, more deliberate read.
 */

/** Fraction of the track spent scrolling the demo, before the lift starts. */
const SCROLL_PHASE_END = 0.82;
/** Where the lift begins. The gap after SCROLL_PHASE_END is a beat of rest. */
const LIFT_PHASE_START = 0.84;

export default function HeroDemo() {
  const trackRef = useRef<HTMLDivElement>(null);

  /* 0 when the track's top pins to the viewport top, 1 when its bottom reaches
     the viewport bottom — exactly the interval the section is stuck. */
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start start", "end end"],
  });

  /* The demo bottoms out at SCROLL_PHASE_END rather than at the end of the
     track, so the recede has room to play against a demo that has already
     finished. useTransform clamps, so it stays at 1 for the rest. */
  const demoScroll = useTransform(
    scrollYProgress,
    [0, SCROLL_PHASE_END],
    [0, 1],
  );

  /**
   * The lift, and why it travels the window's whole height.
   *
   * While the window is pinned it does not move, so anything scrolling up
   * behind it passes behind it unseen — the first attempt at this hid the
   * problem section's own headline and revealed it already half-read. The
   * window therefore has to get out of the way itself: over the last stretch of
   * the track it translates clear of the top of the viewport, uncovering the
   * section parked a full viewport beneath it (page.tsx). The small scale is
   * depth, so it reads as receding rather than as being yanked.
   */
  const scale = useTransform(scrollYProgress, [LIFT_PHASE_START, 1], [1, 0.97]);
  const y = useTransform(
    scrollYProgress,
    [LIFT_PHASE_START, 1],
    ["0%", "-112%"],
  );

  return (
    <section
      aria-label="Interactive demo"
      /* Above the hero copy it overlaps, and above the problem section pulled
         up underneath it — the whole point of the layering. */
      className="relative z-20 -mt-[32vh] sm:-mt-[40vh]"
    >
      <div ref={trackRef} className="relative h-[320vh]">
        <div className="sticky top-0 flex h-svh flex-col px-4 pt-16 pb-8 sm:px-6 sm:pt-20">
          {/* The transform lives on the inner element, not on the sticky one:
              a transformed ancestor becomes the containing block for its
              descendants and makes `position: sticky` behave unpredictably. */}
          <motion.div
            style={{ scale, y }}
            className="mx-auto flex min-h-0 w-full max-w-[104rem] flex-1 flex-col"
          >
            <InteractiveHero demoScrollProgress={demoScroll} fillHeight />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
