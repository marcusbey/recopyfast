import { Header } from "@/components/layout/Header"
import Footer from "@/components/layout/Footer"
import EnhancedHero from "@/components/sections/EnhancedHero"
import Problem from "@/components/sections/Problem"
import HowItWorks from "@/components/sections/HowItWorks"
import Features from "@/components/sections/Features"
import Pricing from "@/components/sections/Pricing"
import EnhancedSocialProof from "@/components/sections/EnhancedSocialProof"

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      
      <main>
        <EnhancedHero />
        <Problem />
        <HowItWorks />
        <Features />
        <Pricing />
        <EnhancedSocialProof />

        {/* Final CTA */}
        <section className="py-24 px-6 bg-gradient-to-r from-blue-600 to-purple-600 text-white relative overflow-hidden">
          <div className="container mx-auto max-w-4xl text-center relative z-10">
            <h2 className="font-bold text-3xl md:text-4xl mb-4">Ready to Transform Your Website?</h2>
            <p className="text-xl mb-8 text-blue-100">
              Join thousands of websites using ReCopyFast for intelligent content management
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="px-8 py-3 text-lg bg-white text-gray-900 hover:bg-gray-100 font-semibold rounded-lg transition-colors">
                Start Free Trial
                <span className="ml-2">→</span>
              </button>
              <button className="px-8 py-3 text-lg border-white text-white hover:bg-white hover:text-blue-600 bg-transparent font-semibold border rounded-lg transition-colors">
                <span className="mr-2">▶</span>
                Schedule Demo
              </button>
            </div>
          </div>
          
          {/* Decorative elements */}
          <div className="absolute top-10 left-10 w-20 h-20 bg-white/10 rounded-full blur-xl"></div>
          <div className="absolute bottom-10 right-10 w-32 h-32 bg-white/10 rounded-full blur-xl"></div>
        </section>
      </main>

      <Footer />
    </div>
  );
}