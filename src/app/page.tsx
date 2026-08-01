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

// Dynamic import for MeshBackground to avoid SSR issues with Three.js
const MeshBackground = dynamic(
  () => import("@/components/three/MeshBackground"),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-sky-50 to-sky-100" />
    ),
  },
);

export default function Home() {
  const { scrollProgress } = useLenis();

  return (
    <div className="min-h-screen">
      {/* 3D Mesh Background - pulses with scroll */}
      <MeshBackground scrollProgress={scrollProgress} />

      <Header />
      <main className="relative z-10">
        <Hero />
        <ValueProposition />

        {/* Interactive Demo Websites Section */}
        <section className="py-20 px-6 bg-white/70 backdrop-blur-xl border-y border-sky-100/50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
                See It In Action
              </h2>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                Try editing content on these demo websites. Click any text to
                see how ReCopyFast works.
              </p>
            </div>
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
