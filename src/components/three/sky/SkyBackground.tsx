"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
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
 */

/**
 * Above this the raymarcher's cost stops being worth its resolution. Cost is
 * quadratic in this number, so it is the cheapest dial available: 0.85 -> 0.72
 * is a ~30% saving for a difference that is invisible on a subject this soft,
 * behind panes that blur at 32px.
 */
const MAX_DPR_VOLUMETRIC = 0.72;
const MAX_DPR_LAYERED = 1.5;

const FADE_PER_SECOND = 2.4;

interface SceneProps {
  mouseRef: React.RefObject<{ x: number; y: number }>;
  scrollProgress: number;
  wantsVolumetric: boolean;
  isAnimating: boolean;
}

function Scene({
  mouseRef,
  scrollProgress,
  wantsVolumetric,
  isAnimating,
}: SceneProps) {
  /* A mutable object rather than React state: the cross-fade runs at frame rate
     and driving it through setState would re-render the tree ~25 times per fade
     for no benefit. Only the final mount/unmount decision touches React. */
  const fade = useRef({ value: wantsVolumetric ? 1 : 0 });
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
        scrollProgress={scrollProgress}
        isAnimating={isAnimating}
      />
      {isVolumetricMounted && (
        <SkyVolumetric
          mouseRef={mouseRef}
          scrollProgress={scrollProgress}
          fade={fade.current}
          isAnimating={isAnimating}
        />
      )}
    </>
  );
}

interface SkyBackgroundProps {
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
          scrollProgress={scrollProgress}
          wantsVolumetric={wantsVolumetric}
          isAnimating={!prefersReducedMotion}
        />
      </Canvas>

      {/* Sits behind the canvas and shows through only if WebGL is unavailable
          or the context is lost. Matches the shader's horizon-to-zenith ramp so
          the failure is a flatter sky, not a different one. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#3d78db] via-[#9dc4ee] to-[#c7e0f7]" />
    </div>
  );
}
