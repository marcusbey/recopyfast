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
import InteractiveHero from "@/components/landing/InteractiveHero";

// Dynamic import to avoid SSR issues with Three.js. The loading gradient runs
// the same horizon-to-zenith ramp as the shader, so the hand-off is a sharpening
// rather than a colour change.
const SkyBackground = dynamic(
  () => import("@/components/three/sky/SkyBackground"),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-[#3d78db] via-[#9dc4ee] to-[#c7e0f7]" />
    ),
  },
);

export default function Home() {
  const { scrollProgress } = useLenis();

  return (
    <div className="min-h-screen">
      {/* Volumetric sky above the fold, cheap layered sky below it. */}
      <SkyBackground scrollProgress={scrollProgress} />

      <Header />
      <main className="relative z-10">
        <Hero />
        <ValueProposition />

        {/* Interactive Demo Websites Section */}
        {/* Solid white, not glass: the demo sites below are themselves full
            page designs with their own backgrounds, and showing sky between
            them made the section read as three floating cards rather than as
            three websites. */}
        <section className="solid-sheet border-y border-slate-200/80 py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
                See It In Action
              </h2>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Three real-looking customer sites, three different designers.
                Click any text or photograph to change it.
              </p>
            </div>
          </div>
          {/* The demo breaks out of the page's 7xl measure: these are supposed
              to read as full websites, and boxing them into the article column
              was the main reason they did not. */}
          <div className="max-w-[104rem] mx-auto">
            <InteractiveHero />
          </div>
        </section>

        <HowItWorks />
        <Benefits />
        <Pricing />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
