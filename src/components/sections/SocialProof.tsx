"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Star } from "lucide-react";

const testimonials = [
  {
    quote:
      "We used to wait 3 days for the dev team to change a headline. Now our marketing team does it themselves in seconds. Game changer.",
    author: "Sarah Chen",
    role: "Head of Marketing",
    company: "TechCorp",
    rating: 5,
  },
  {
    quote:
      "Finally, a tool that lets non-technical people update website copy without breaking anything. Our content velocity increased 10x.",
    author: "Marcus Johnson",
    role: "Product Manager",
    company: "StartupXYZ",
    rating: 5,
  },
  {
    quote:
      "The AI suggestions are surprisingly good. It helped us improve our conversion rates by suggesting better CTAs.",
    author: "Emily Rodriguez",
    role: "Growth Lead",
    company: "ScaleUp Inc",
    rating: 5,
  },
  {
    quote:
      "Setup took 5 minutes. Literally just a script tag. Our entire team was editing content within the hour.",
    author: "David Kim",
    role: "CTO",
    company: "DevAgency",
    rating: 5,
  },
  {
    quote:
      "We manage content for 50+ client sites. ReCopyFast saved us hundreds of hours in developer time every month.",
    author: "Lisa Thompson",
    role: "Agency Owner",
    company: "Digital First",
    rating: 5,
  },
  {
    quote:
      "The real-time collaboration is incredible. Multiple team members can edit different pages simultaneously.",
    author: "James Wilson",
    role: "Content Director",
    company: "MediaCo",
    rating: 5,
  },
];

export default function SocialProof() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      className="py-32 px-6 bg-white/80 backdrop-blur-sm relative overflow-hidden"
    >
      {/* Subtle background */}
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-sky-50 to-transparent rounded-full opacity-50" />
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-emerald-600 bg-emerald-50 rounded-full mb-6">
            Loved by teams
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-slate-900 tracking-tight mb-6">
            Don&apos;t take our word for it
          </h2>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto">
            Hear from the teams who freed themselves from content bottlenecks
          </p>
        </motion.div>

        {/* Rating summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="flex justify-center items-center gap-4 mb-16"
        >
          <div className="flex">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="w-6 h-6 fill-amber-400 text-amber-400" />
            ))}
          </div>
          <span className="text-lg font-semibold text-slate-900">4.9/5</span>
          <span className="text-slate-400">from 500+ reviews</span>
        </motion.div>

        {/* Testimonials grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((testimonial, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.1 * i }}
              className="group bg-white rounded-2xl p-8 border border-sky-100 hover:border-sky-200 hover:shadow-lg hover:shadow-sky-100/30 transition-all duration-300"
            >
              {/* Stars */}
              <div className="flex mb-4">
                {[...Array(testimonial.rating)].map((_, j) => (
                  <Star
                    key={j}
                    className="w-4 h-4 fill-amber-400 text-amber-400"
                  />
                ))}
              </div>

              {/* Quote */}
              <p className="text-slate-700 leading-relaxed mb-6">
                &ldquo;{testimonial.quote}&rdquo;
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-500 to-emerald-500 flex items-center justify-center text-white font-semibold text-sm">
                  {testimonial.author
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div>
                  <div className="font-semibold text-slate-900 text-sm">
                    {testimonial.author}
                  </div>
                  <div className="text-slate-500 text-xs">
                    {testimonial.role} at {testimonial.company}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Logo cloud */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="mt-20 pt-16 border-t border-sky-100"
        >
          <p className="text-center text-sm text-slate-400 uppercase tracking-widest mb-8">
            Used by innovative teams at
          </p>
          <div className="flex flex-wrap justify-center items-center gap-x-12 gap-y-6">
            {[
              "Vercel",
              "Stripe",
              "Linear",
              "Notion",
              "Figma",
              "Supabase",
              "Raycast",
              "Loom",
            ].map((brand) => (
              <span
                key={brand}
                className="text-slate-300 text-xl font-bold tracking-tight hover:text-slate-400 transition-colors"
              >
                {brand}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
