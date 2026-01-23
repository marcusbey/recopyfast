"use client";

import { useEffect, useState, useCallback } from "react";
import Lenis from "lenis";

export interface UseLenisReturn {
  scrollProgress: number;
  lenis: Lenis | null;
  scrollTo: (target: string | number | HTMLElement) => void;
}

export function useLenis(): UseLenisReturn {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [lenis, setLenis] = useState<Lenis | null>(null);

  useEffect(() => {
    const lenisInstance = new Lenis({
      lerp: 0.1,
      duration: 1.2,
      smoothWheel: true,
    });

    function onScroll({ progress }: { progress: number }) {
      setScrollProgress(progress);
    }

    lenisInstance.on("scroll", onScroll);

    function raf(time: number) {
      lenisInstance.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);
    setLenis(lenisInstance);

    return () => {
      lenisInstance.destroy();
    };
  }, []);

  const scrollTo = useCallback(
    (target: string | number | HTMLElement) => {
      lenis?.scrollTo(target);
    },
    [lenis],
  );

  return { scrollProgress, lenis, scrollTo };
}
