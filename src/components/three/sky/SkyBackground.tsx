"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import {
  readScrollProgress,
  subscribeScrollProgress,
} from "@/lib/hooks/useLenis";
import SkyLayered from "./SkyLayered";
import SkyVolumetric from "./SkyVolumetric";

/**
 * Picks which sky to render and cross-fades between them.
 *
 * The raymarcher is worth roughly five times the cheap path per frame, and it
 * is worth that only above the fold — nobody studies the sky behind a pricing
 * table. So it runs while the hero is on screen and is torn down completely
 * once the hero leaves, rather than being left running behind content where it
 * cannot be seen but still costs a frame budget and a battery.
 *
 * Three things reduce work here, and all three matter on a laptop on battery:
 *   - device pixel ratio is capped (a 3x phone would otherwise shade 9x the pixels)
 *   - the volumetric path unmounts entirely below the fold
 *   - `prefers-reduced-motion` switches the loop off after a single frame
 *
 * A fourth thing matters more than all of them: scroll never reaches React.
 * Progress is published by useLenis and pulled here inside the frame loop, so
 * scrolling the page costs no renders at all. See Scene.
 */

/**
 * Above this the raymarcher's cost stops being worth its resolution. Cost is
 * quadratic in this number, so it is the cheapest dial available: 0.85 -> 0.72
 * is a ~30% saving for a difference that is invisible on a subject this soft,
 * behind panes that blur at 32px.
 */
const MAX_DPR_VOLUMETRIC = 0.72;
/**
 * The layered path covers the whole page rather than one viewport, so it is on
 * screen for most of a visit and its resolution is the single largest fixed
 * cost in the backdrop. 1.5 shaded 4.7 megapixels through six noise layers; at
 * 1.2 that is 3.0, and against a soft subject behind panes blurring at 32px the
 * difference does not survive being looked at.
 */
const MAX_DPR_LAYERED = 1.2;

const FADE_PER_SECOND = 2.4;

/**
 * Reduced motion runs the canvas on demand, so nothing redraws unless something
 * asks it to. Scroll still has to move the sky — the sunset at the bottom of the
 * page is scroll-driven and freezing it would leave those readers on a blue sky
 * under an orange call to action. This is how coarsely it moves: 40 steps over
 * the page is visible progress at 40 redraws for the whole visit, rather than
 * one per frame, and stepping is the honest behaviour to give someone who has
 * asked for less animation.
 */
const REDUCED_MOTION_STEPS = 40;

interface SceneProps {
  mouseRef: React.RefObject<{ x: number; y: number }>;
  fallbackProgress: number;
  wantsVolumetric: boolean;
  isAnimating: boolean;
}

function Scene({
  mouseRef,
  fallbackProgress,
  wantsVolumetric,
  isAnimating,
}: SceneProps) {
  /* A mutable object rather than React state: the cross-fade runs at frame rate
     and driving it through setState would re-render the tree ~25 times per fade
     for no benefit. Only the final mount/unmount decision touches React. */
  const fade = useRef({ value: wantsVolumetric ? 1 : 0 });
  /* Scroll travels the same way, and for a far larger reason. It used to arrive
     as a number prop, so every step of the scroll re-rendered the landing tree
     and this scene under it: a profiled six-second scroll spent 3,371ms across
     204 React commits producing output that never changed, which is what made
     the page judder. Resolved once per frame into a box both shaders read, it
     costs a property lookup. */
  /* Computed on read rather than assigned once per frame, which matters more
     than it looks. R3F runs a child's useFrame subscription before its parent's,
     because that is the order layout effects register in. Assigning here meant
     both shaders read the value this scene had written on the *previous* frame.
     Under frameloop="always" that is 16ms of lag nobody can see. Under "demand"
     — the reduced-motion path — exactly one frame is rendered per scroll step,
     so being a frame behind means the sky draws the position the reader has
     already left and then stops, and the scroll-driven sunset never arrives at
     all. A getter has no ordering to get wrong. */
  /* Written during render, which React discourages, and deliberately kept that
     way. The value comes from this render's own props and is idempotent, so a
     StrictMode double render writes the same thing twice, and the getter is only
     read from frame callbacks that run after commit.

     This is load-bearing if `fallbackProgress` ever carries a real value — today
     the only caller does not pass it, so it is always 0. Two things to know then.
     Moving the assignment into the useFrame below is the tempting fix and the
     wrong one: children's frame callbacks run before their parent's, so the
     fallback would be a frame stale in exactly the case it is read — a page with
     no Lenis, where it is the only source — reintroducing what the getter above
     removes, one level down and harder to see. The correct move is to leave the
     write here and let the object identity change with the prop, so the getter
     closes over the current value instead of reaching through a ref. That costs
     an object per prop change: free while the prop is static, correct once it
     is not. */
  const fallbackRef = useRef(fallbackProgress);
  fallbackRef.current = fallbackProgress;
  const scroll = useRef({
    /* Null means nothing is driving scroll on this page, so the prop is all
       there is to go on. A page that mounts this sky without useLenis then gets
       a correctly positioned one instead of being pinned to the top. */
    get value() {
      return readScrollProgress() ?? fallbackRef.current;
    },
  });
  const [isVolumetricMounted, setIsVolumetricMounted] =
    useState(wantsVolumetric);

  useFrame((_, delta) => {
    const target = wantsVolumetric ? 1 : 0;
    const step = FADE_PER_SECOND * Math.min(delta, 0.1);

    if (fade.current.value < target) {
      fade.current.value = Math.min(target, fade.current.value + step);
    } else if (fade.current.value > target) {
      fade.current.value = Math.max(target, fade.current.value - step);
    }

    /* Mount as soon as it is wanted; unmount only once it has finished fading
       out, so the expensive shader is never visible popping in or out. */
    const shouldBeMounted = wantsVolumetric || fade.current.value > 0.01;
    if (shouldBeMounted !== isVolumetricMounted) {
      setIsVolumetricMounted(shouldBeMounted);
    }
  });

  return (
    <>
      <SkyLayered
        mouseRef={mouseRef}
        scroll={scroll.current}
        coveredBy={isVolumetricMounted ? fade.current : null}
        isAnimating={isAnimating}
      />
      {isVolumetricMounted && (
        <SkyVolumetric
          mouseRef={mouseRef}
          scroll={scroll.current}
          fade={fade.current}
          isAnimating={isAnimating}
        />
      )}
    </>
  );
}

/**
 * Requests a redraw when scroll moves, for the reduced-motion case only.
 *
 * With `frameloop="demand"` the canvas draws once and then waits. Previously a
 * changing prop invalidated it as a side effect of re-rendering; now that scroll
 * bypasses React entirely, nothing would ever ask for the next frame. This asks,
 * at a coarse step, so the sky still follows the page down without the loop
 * running free.
 */
function InvalidateOnScroll() {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    let lastStep = -1;
    return subscribeScrollProgress((progress) => {
      const step = Math.round(progress * REDUCED_MOTION_STEPS);
      if (step === lastStep) return;
      lastStep = step;
      invalidate();
    });
  }, [invalidate]);

  return null;
}

interface SkyBackgroundProps {
  /**
   * Scroll progress for pages that do not run Lenis. When Lenis is driving,
   * that live value wins and this is never read — deliberately, because a
   * number prop is a render per scroll step and this backdrop is behind the
   * entire landing page.
   */
  scrollProgress?: number;
  /** Element that decides when the expensive path is worth running. */
  heroSelector?: string;
}

export default function SkyBackground({
  scrollProgress = 0,
  heroSelector = "#hero",
}: SkyBackgroundProps) {
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const [isHeroVisible, setIsHeroVisible] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isSmallScreen, setIsSmallScreen] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    /* Coarse pointer rather than a width breakpoint: what matters is the GPU
       behind the screen, and a phone in landscape is still a phone. */
    const coarseQuery = window.matchMedia(
      "(pointer: coarse), (max-width: 767px)",
    );

    const syncMotion = () => setPrefersReducedMotion(motionQuery.matches);
    const syncCoarse = () => setIsSmallScreen(coarseQuery.matches);

    syncMotion();
    syncCoarse();
    motionQuery.addEventListener("change", syncMotion);
    coarseQuery.addEventListener("change", syncCoarse);

    return () => {
      motionQuery.removeEventListener("change", syncMotion);
      coarseQuery.removeEventListener("change", syncCoarse);
    };
  }, []);

  useEffect(() => {
    const hero = document.querySelector(heroSelector);
    if (!hero) {
      /* No hero on this page: never pay for the expensive path. */
      setIsHeroVisible(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsHeroVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [heroSelector]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      mouseRef.current.x = event.clientX / window.innerWidth;
      mouseRef.current.y = 1 - event.clientY / window.innerHeight;
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const wantsVolumetric =
    isHeroVisible && !isSmallScreen && !prefersReducedMotion;

  return (
    <div className="fixed inset-0 -z-10" aria-hidden="true">
      <Canvas
        /* Half-ish resolution while raymarching. The clouds are a soft, low
           frequency subject and the panes over them blur at 32px, so the
           upscale is genuinely invisible — which is what makes the expensive
           path affordable at all. */
        dpr={wantsVolumetric ? MAX_DPR_VOLUMETRIC : MAX_DPR_LAYERED}
        /* Both shaders are fullscreen quads that ignore the camera; this exists
           only because R3F requires one. */
        camera={{ position: [0, 0, 1], fov: 50 }}
        gl={{ antialias: false, alpha: false, powerPreference: "low-power" }}
        /* Reduced motion: render once and stop. Everything downstream still
           renders, it simply stops advancing. */
        frameloop={prefersReducedMotion ? "demand" : "always"}
      >
        <Scene
          mouseRef={mouseRef}
          fallbackProgress={scrollProgress}
          wantsVolumetric={wantsVolumetric}
          isAnimating={!prefersReducedMotion}
        />
        {prefersReducedMotion && <InvalidateOnScroll />}
      </Canvas>

      {/* Sits behind the canvas and shows through only if WebGL is unavailable
          or the context is lost. Matches the shader's horizon-to-zenith ramp so
          the failure is a flatter sky, not a different one. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#5a9ce4] via-[#aed3f4] to-[#d6eafa]" />
    </div>
  );
}
