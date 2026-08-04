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
import StickyDemoSection from "@/components/landing/StickyDemoSection";

// Dynamic import to avoid SSR issues with Three.js. The loading gradient runs
// the same horizon-to-zenith ramp as the shader, so the hand-off is a sharpening
// rather than a colour change.
const SkyBackground = dynamic(
  () => import("@/components/three/sky/SkyBackground"),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-[#4a8ed8] via-[#a4cdf0] to-[#cfe6f8]" />
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
        <ValueProposition />

        {/* Interactive demo websites — pinned while page scroll drives the
            demo page's own scroll. See StickyDemoSection for the mechanics. */}
        <StickyDemoSection />

        <HowItWorks />
        <Benefits />
        <Pricing />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
