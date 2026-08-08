"use client";

import { useLenis } from "@/lib/hooks/useLenis";
import dynamic from "next/dynamic";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Hero from "@/components/sections/Hero";
import ValueProposition from "@/components/sections/ValueProposition";
import HowItWorks from "@/components/sections/HowItWorks";
import Benefits from "@/components/sections/Benefits";
import Pricing from "@/components/sections/Pricing";
import FinalCTA from "@/components/sections/FinalCTA";
import HeroDemo from "@/components/landing/HeroDemo";

// Dynamic import to avoid SSR issues with Three.js. The loading gradient runs
// the same horizon-to-zenith ramp as the shader, so the hand-off is a sharpening
// rather than a colour change.
const SkyBackground = dynamic(
  () => import("@/components/three/sky/SkyBackground"),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-[#5a9ce4] via-[#aed3f4] to-[#d6eafa]" />
    ),
  },
);

export default function Home() {
  /* Called for its effect, not its return value: it mounts Lenis and publishes
     scroll progress to the module store the sky reads directly. Destructuring
     `scrollProgress` here and passing it down would put the value back on the
     React render path — one render of this entire tree per scroll step, which
     is the cost useLenis exists to avoid. */
  useLenis();

  return (
    <div className="min-h-screen">
      {/* Volumetric sky above the fold, cheap layered sky below it. */}
      <SkyBackground />

      <Header />
      <main className="relative z-10">
        <Hero />

        {/* The demo, pinned under the headline while page scroll drives the
            demo site's own scroll. See HeroDemo for the mechanics. */}
        <HeroDemo />

        {/* The problem section is stacked UNDER the demo, not after it: the
            negative margin parks it a full viewport beneath the pinned window
            and the low z-index keeps it there, so the window lifting away at
            the end of its track uncovers this section from its own first line
            rather than from the middle. One viewport exactly — that is what
            makes the two motions line up. Both halves of the effect live here
            rather than inside either section, because neither one can see the
            other: the overlap is a fact about their arrangement. */}
        <div className="relative z-0 -mt-[100svh]">
          <ValueProposition />
        </div>

        <HowItWorks />
        <Benefits />
        <Pricing />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
