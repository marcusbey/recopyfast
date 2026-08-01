"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Lenis from "lenis";

export interface UseLenisReturn {
  scrollProgress: number;
  lenis: Lenis | null;
  scrollTo: (target: string | number | HTMLElement) => void;
}

/**
 * Progress is reported in discrete steps rather than continuously.
 *
 * `scrollProgress` is consumed as a React prop and src/app/page.tsx is a client
 * component, so every distinct value re-renders the entire landing tree. Lenis
 * emits a scroll event per animation frame, which meant roughly 60 full-tree
 * re-renders per second while scrolling — the visible instability on the
 * marketing page.
 *
 * 200 steps is finer than a single device pixel of progress on any realistic
 * page height, so the backdrop animation looks identical while a render happens
 * only when the quantised bucket actually changes.
 */
const PROGRESS_STEPS = 200;

export function useLenis(): UseLenisReturn {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const instanceRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const lenisInstance = new Lenis({
      lerp: 0.1,
      duration: 1.2,
      smoothWheel: true,
      /**
       * Without this, in-page anchors do not work.
       *
       * Lenis owns the scroll position while smoothWheel is on. A plain
       * `<a href="#pricing">` performs a native jump that Lenis knows nothing
       * about and immediately overrides from its own internal position, so the
       * page either does not move or snaps back. `anchors` makes Lenis intercept
       * same-page hash links and animate to the target itself, which is what
       * makes the Header's "Features" and "Pricing" links function.
       */
      anchors: true,
    });

    instanceRef.current = lenisInstance;

    let lastStep = -1;
    function onScroll({ progress }: { progress: number }) {
      const step = Math.round(progress * PROGRESS_STEPS);
      if (step === lastStep) return;
      lastStep = step;
      setScrollProgress(step / PROGRESS_STEPS);
    }

    lenisInstance.on("scroll", onScroll);

    // The frame handle must be captured and cancelled. Previously `raf`
    // re-scheduled itself unconditionally while cleanup only called destroy(),
    // leaving an orphaned animation loop driving a destroyed instance for the
    // life of the page — and a fresh loop started on every remount, so they
    // accumulated.
    let frame = 0;
    function raf(time: number) {
      lenisInstance.raf(time);
      frame = requestAnimationFrame(raf);
    }
    frame = requestAnimationFrame(raf);

    setLenis(lenisInstance);

    return () => {
      cancelAnimationFrame(frame);
      lenisInstance.off("scroll", onScroll);
      lenisInstance.destroy();
      instanceRef.current = null;
    };
  }, []);

  // Reads the ref rather than the `lenis` state value, so the callback identity
  // is stable from first render and callers need no guard for the one-render
  // window where state is still null.
  const scrollTo = useCallback((target: string | number | HTMLElement) => {
    instanceRef.current?.scrollTo(target);
  }, []);

  return { scrollProgress, lenis, scrollTo };
}
