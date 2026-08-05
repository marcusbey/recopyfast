"use client";

import { motion, useInView } from "framer-motion";
import { useRef, useState } from "react";
import { Copy, Check, Code2, Scan, MousePointerClick } from "lucide-react";

/*
  All three steps used to describe a product we do not ship, so each one below
  is written against the code that actually runs:

  - Step 1 advertised `https://cdn.recopyfast.com/embed.js` carrying nothing but
    a site id. That host has never existed, and the widget aborts in its own
    entry guard when `data-site-token` is missing — so the snippet a visitor
    copied from this page could not have started even against the right origin.
    The shape below mirrors buildEmbedScript() in src/lib/sites/embed-script.ts,
    minus the `data-ws-url` it still emits (nothing listens on it), with the two
    per-site values left as placeholders so nobody mistakes the template for an
    installable tag.
  - Step 2 claimed links were editable. scanForContent() selects
    `a.rcf-editable-link`, not `a` — links are opt-in on purpose, because the
    alternative is every nav item and footer link becoming an edit target.
  - Steps 2 and 3 promised real-time. Real-time is gone: establishConnection()
    returns before loading socket.io because no endpoint is configured, and a
    visitor picks up published copy from GET /api/content/:siteId on page load.
*/
const steps = [
  {
    number: "01",
    icon: Code2,
    title: "Copy one line of code",
    description:
      "Register your site and the dashboard hands you the tag with your site ID and site token already filled in. Paste it before the closing body tag. No build step, no framework change, no backend.",
    code: `<script src="https://recopyfa.st/embed/recopyfast.js"
        data-site-id="YOUR_SITE_ID"
        data-site-token="YOUR_SITE_TOKEN"
        data-api-url="https://recopyfa.st/api"></script>`,
    visual: "code",
  },
  {
    number: "02",
    icon: Scan,
    title: "We detect everything",
    description:
      "ReCopyFast maps the copy on the page as it loads: headings, paragraphs, list items, table cells, labels, buttons and images. Links stay untouched unless you tag them rcf-editable-link, so nobody can accidentally rewrite your navigation.",
    code: `✓ Scanning page elements...
✓ 47 editable elements mapped
✓ 6 links skipped — no rcf-editable-link
✓ AI suggestions ready`,
    visual: "scan",
  },
  {
    number: "03",
    icon: MousePointerClick,
    title: "Click anywhere to edit",
    description:
      "Open your site from the dashboard and it comes up editable. Anyone you have given edit access clicks a piece of text, types, and publishes — visitors get the new copy the next time the page loads.",
    code: `// Your team's new workflow:
1. Open the site from your dashboard
2. Click any text and type
3. Publish. Live on the next page load.`,
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
      className="glass-sheet relative overflow-hidden border-y border-white/40 py-24 sm:py-32 px-6"
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
          <span className="mb-6 inline-block text-sm font-semibold uppercase tracking-[0.075em] text-sky-700">
            How it works
          </span>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 mb-6">
            Three steps.
            <br />
            <span className="text-slate-400">Five minutes.</span>
          </h2>
          <p className="text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto">
            No complex migration. No learning curve. Just direct content
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

                <h3 className="text-2xl font-semibold text-slate-900 mb-4">
                  {step.title}
                </h3>

                <p className="text-lg text-slate-600 leading-relaxed mb-8">
                  {step.description}
                </p>

                {i === 0 && (
                  <>
                    {/* "Copy script tag" implied the thing on this page was
                        installable. It is a template: the site ID and site
                        token are minted per site at registration, and the
                        widget refuses to start without the token. */}
                    <button
                      onClick={handleCopy}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-sky-50 hover:bg-sky-100 rounded-lg text-sm font-medium text-sky-700 transition-colors border border-sky-200"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-teal-600" />
                          Copied to clipboard
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copy the template
                        </>
                      )}
                    </button>
                    <p className="mt-3 text-sm text-slate-500">
                      Your real tag comes from the dashboard when you register
                      the site — the token is issued per site and is not
                      optional.
                    </p>
                  </>
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

                    {/* Status indicator for step 2. The pinging dot read as a
                        heartbeat on an open connection — there is no socket to
                        keep alive, so it is a plain dot on a finished scan. */}
                    {step.visual === "scan" && (
                      <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 text-sm text-white/50">
                        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        Ready to edit
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
          <div className="inline-flex items-center gap-3 px-6 py-3 bg-sky-50 rounded-full border border-sky-100">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500"></span>
            </span>
            {/* "Average setup time: 3 minutes 32 seconds" was a statistic to
                the second that nothing measures — we collect no install
                telemetry. The estimate below is the same one FinalCTA makes,
                and it is offered as an estimate. */}
            <span className="font-semibold text-sky-700">
              Set up in under five minutes
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
