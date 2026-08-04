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

function publish(progress: number) {
  liveProgress = progress;
  for (const callback of subscribers) callback(progress);
}

/**
 * Progress read from the document's own scroll position rather than from Lenis.
 * Used when smooth scrolling is off, so consumers see the same 0-to-1 value
 * either way and none of them has to know which mode is driving the page.
 */
function readNativeProgress(): number {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  if (maxScroll <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / maxScroll));
}

function usePrefersReducedMotion(): boolean {
  /* Resolved during the first render rather than in the effect that keeps it in
     sync. Defaulting to false would construct a Lenis instance and tear it down
     again on mount for exactly the readers who asked for no smooth scrolling.
     Nothing renders from this value — it only decides which effect body runs —
     so the server's `false` and the client's answer cannot disagree in markup. */
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(query.matches);

    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return prefersReducedMotion;
}

export function useLenis(): UseLenisReturn {
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const instanceRef = useRef<Lenis | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    /**
     * Reduced motion means no Lenis at all, rather than a Lenis configured to
     * move quickly.
     *
     * Smooth scrolling is the animation this preference is most directly about:
     * every wheel tick becomes a 1.2s eased glide the reader did not ask for,
     * and the page keeps moving after the input stops. Shortening the duration
     * still animates; the honest response is to hand the scroll back to the
     * browser, which is also what makes `<a href="#pricing">` an instant native
     * jump again — anchors only needed intercepting because Lenis was otherwise
     * overriding the position they set.
     *
     * Progress still has to be published, because the sky's sunset is driven by
     * it. Freezing it would leave these readers on a blue sky under an orange
     * call to action. The read is deferred to an animation frame for the same
     * reason the Header's is: reading scrollY inside the event forces a layout
     * flush.
     */
    if (prefersReducedMotion) {
      setLenis(null);
      instanceRef.current = null;

      let frame = 0;
      const readAndPublish = () => {
        frame = 0;
        publish(readNativeProgress());
      };
      const onNativeScroll = () => {
        if (frame) return;
        frame = requestAnimationFrame(readAndPublish);
      };

      /* Publish the current position immediately, so a page opened partway down
         starts with the sky it should have rather than the one at the top. */
      readAndPublish();
      window.addEventListener("scroll", onNativeScroll, { passive: true });
      /* Resizing changes the denominator, so the same scrollY is a different
         progress. Without this the sky drifts out of step on rotation. */
      window.addEventListener("resize", onNativeScroll, { passive: true });

      return () => {
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener("scroll", onNativeScroll);
        window.removeEventListener("resize", onNativeScroll);
        liveProgress = null;
      };
    }

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

    /* Publish where the page actually is, for the same reason the native path
       does. Lenis emits nothing until the reader moves, so without this the
       store sits at `null` from mount until the first scroll — and consumers
       read `null` as "nothing is driving this page" and fall back to 0. A page
       restored partway down therefore showed the top-of-page sky until touched,
       and toggling reduced motion off mid-page did the same, because that now
       rebuilds this effect. Lenis takes its own initial position from the
       document, so this is the value it would report anyway. */
    publish(readNativeProgress());

    /* Published from the document, not from Lenis's own `progress`. Lenis
       computes progress against its internally measured `limit`, and when that
       measurement disagrees with the document's real max-scroll — sticky
       pinning and late-loading content both cause it — progress tops out well
       short of 1. The visible symptom was the scroll-driven sunset arriving
       half-finished at the bottom of the page: the CTA sat on a grey lerp
       midpoint instead of the dusk sky. The document's own ratio is what the
       reader's position actually is, whichever engine is animating it. */
    function onScroll() {
      publish(readNativeProgress());
    }

    lenisInstance.on("scroll", onScroll);
    /* Resize changes the denominator while emitting no scroll event. */
    window.addEventListener("resize", onScroll, { passive: true });

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
      window.removeEventListener("resize", onScroll);
      lenisInstance.off("scroll", onScroll);
      lenisInstance.destroy();
      instanceRef.current = null;
      // Back to "nobody is driving scroll", so a consumer that outlives this
      // hook falls back rather than freezing at wherever the page happened to
      // be when it unmounted.
      liveProgress = null;
    };
  }, [prefersReducedMotion]);

  // Reads the ref rather than the `lenis` state value, so the callback identity
  // is stable from first render and callers need no guard for the one-render
  // window where state is still null.
  const scrollTo = useCallback((target: string | number | HTMLElement) => {
    const instance = instanceRef.current;
    if (instance) {
      instance.scrollTo(target);
      return;
    }

    /* No Lenis: either it has not mounted yet, or the reader asked for reduced
       motion and it never will. Both want the browser's own instant scroll —
       animating here is exactly what the preference rules out. */
    if (typeof target === "number") {
      window.scrollTo({ top: target, behavior: "auto" });
      return;
    }

    const element =
      typeof target === "string" ? document.querySelector(target) : target;
    element?.scrollIntoView({ behavior: "auto" });
  }, []);

  return { scrollProgress: liveProgress ?? 0, lenis, scrollTo };
}
