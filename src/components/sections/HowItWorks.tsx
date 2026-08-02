"use client";

import { motion, useInView } from "framer-motion";
import { useRef, useState } from "react";
import { Copy, Check, Code2, Scan, MousePointerClick } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: Code2,
    title: "Copy one line of code",
    description:
      "Add our lightweight script to any page. No build steps, no framework changes, no backend setup. Just paste and you're ready.",
    code: `<script src="https://cdn.recopyfast.com/embed.js"
        data-site-id="your-site-id"></script>`,
    visual: "code",
  },
  {
    number: "02",
    icon: Scan,
    title: "We detect everything",
    description:
      "ReCopyFast automatically finds and maps every text element on your site. Headlines, paragraphs, buttons, links — all ready to edit.",
    code: `✓ Scanning page elements...
✓ Found 47 editable text elements
✓ AI suggestions ready
✓ Real-time sync enabled`,
    visual: "scan",
  },
  {
    number: "03",
    icon: MousePointerClick,
    title: "Click anywhere to edit",
    description:
      "That's it. Anyone on your team can now click any text on your live website and edit it instantly. Changes go live immediately.",
    code: `// Your team's new workflow:
1. Click any text
2. Type your changes
3. Done. It's live.`,
    visual: "edit",
  },
];

export default function HowItWorks() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(steps[0].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      ref={ref}
      className="glass-sheet relative overflow-hidden border-y border-white/40 py-32 px-6"
    >
      {/* Decorative line */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-sky-200 to-transparent hidden lg:block" />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-24"
        >
          <span className="inline-block px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-sky-600 bg-sky-50 rounded-full mb-6">
            How it works
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-slate-900 tracking-tight mb-6">
            Three steps.
            <br />
            <span className="text-slate-400">Five minutes.</span>
          </h2>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto">
            No complex migration. No learning curve. Just instant content
            control.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="space-y-24 lg:space-y-32">
          {steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 60 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.2 * i }}
              className={`flex flex-col ${i % 2 === 0 ? "lg:flex-row" : "lg:flex-row-reverse"} items-center gap-12 lg:gap-20`}
            >
              {/* Content side */}
              <div className="flex-1 max-w-xl">
                <div className="flex items-center gap-4 mb-6">
                  <span className="text-5xl font-bold text-sky-700">
                    {step.number}
                  </span>
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-600">
                    <step.icon className="w-7 h-7 text-white" />
                  </div>
                </div>

                <h3 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                  {step.title}
                </h3>

                <p className="text-lg text-slate-600 leading-relaxed mb-8">
                  {step.description}
                </p>

                {i === 0 && (
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-sky-50 hover:bg-sky-100 rounded-lg text-sm font-medium text-sky-700 transition-colors border border-sky-200"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-500" />
                        Copied to clipboard
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy script tag
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Visual side */}
              <div className="flex-1 w-full max-w-xl">
                <div className="relative">
                  {/* Glow effect */}

                  {/* Code block */}
                  <div className="relative bg-slate-900 rounded-2xl p-6 shadow-2xl border border-sky-200/20">
                    {/* Window controls */}
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500" />
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                    </div>

                    {/* Code content */}
                    <pre className="font-mono text-sm text-emerald-400 whitespace-pre-wrap leading-relaxed">
                      {step.code}
                    </pre>

                    {/* Status indicator for step 2 */}
                    {step.visual === "scan" && (
                      <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 text-sm text-white/50">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Live and ready
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="mt-24 text-center"
        >
          <div className="inline-flex items-center gap-3 px-6 py-3 bg-emerald-50 rounded-full border border-emerald-100">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="font-semibold text-emerald-700">
              Average setup time: 3 minutes 32 seconds
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
