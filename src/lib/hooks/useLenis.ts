"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Lenis from "lenis";

export interface UseLenisReturn {
  /**
   * Progress as of the last render — deliberately not a live value.
   *
   * Reading this does not subscribe the caller to anything, and scrolling does
   * not re-render whoever holds it. Anything that needs progress at frame rate
   * must call `readScrollProgress()` from inside its own animation loop, which
   * is both cheaper and finer-grained than a prop could ever be. See the note
   * on `publish` below for why.
   */
  scrollProgress: number;
  lenis: Lenis | null;
  scrollTo: (target: string | number | HTMLElement) => void;
}

/**
 * Scroll progress lives in a module-scope variable rather than React state.
 *
 * It used to be state, quantised to 200 steps to limit how often it changed.
 * That was still one render of the entire landing tree per animation frame on
 * any scroll faster than a crawl, because 200 steps across a 8,400px page is a
 * step every 42px and a flick moves further than that in a single frame. A
 * profile of a six-second scroll measured 204 commits costing 3,371ms of React
 * render time — more than half the wall clock spent re-rendering a tree whose
 * output never changed, which is what made the page judder.
 *
 * Nothing about the sky needs React. It is a shader reading uniforms inside a
 * `useFrame` callback, so it can pull the current value at exactly the moment
 * it needs it. Publishing here and pulling there removes the render entirely
 * and, as a bonus, gives the shader the unquantised value.
 */
let liveProgress: number | null = null;

/** Notified on every scroll event, for consumers with no frame loop of their own. */
const subscribers = new Set<(progress: number) => void>();

/**
 * Current scroll progress, 0 at the top of the page and 1 at the bottom, or
 * `null` when no Lenis instance is mounted. The null case matters: it lets a
 * consumer tell "the page is at the top" apart from "nothing is driving scroll
 * on this page", and fall back to a static value rather than pinning itself to
 * zero.
 */
export function readScrollProgress(): number | null {
  return liveProgress;
}

/** Returns an unsubscribe function. Safe to call before Lenis mounts. */
export function subscribeScrollProgress(
  callback: (progress: number) => void,
): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function useLenis(): UseLenisReturn {
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

    function onScroll({ progress }: { progress: number }) {
      liveProgress = progress;
      for (const callback of subscribers) callback(progress);
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
      // Back to "nobody is driving scroll", so a consumer that outlives this
      // hook falls back rather than freezing at wherever the page happened to
      // be when it unmounted.
      liveProgress = null;
    };
  }, []);

  // Reads the ref rather than the `lenis` state value, so the callback identity
  // is stable from first render and callers need no guard for the one-render
  // window where state is still null.
  const scrollTo = useCallback((target: string | number | HTMLElement) => {
    instanceRef.current?.scrollTo(target);
  }, []);

  return { scrollProgress: liveProgress ?? 0, lenis, scrollTo };
}
