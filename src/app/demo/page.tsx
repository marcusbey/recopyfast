"use client";

import Link from "next/link";
import {
  ArrowRight,
  MousePointerClick,
  Type,
  Image as ImageIcon,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import InteractiveHero from "@/components/landing/InteractiveHero";

/**
 * The demo page.
 *
 * REBUILT, and worth recording why rather than leaving it looking like a
 * restyle. The previous version mounted `ReCopyFastLoader`, which redirected the
 * page into staging mode carrying a hard-coded token —
 * `test_staging_token_valid_123` — against a site id that exists in no database.
 * The widget then did exactly the right thing with a token it cannot find: it
 * refused. Every visitor to /demo was met with "Access Denied — Invalid or
 * expired staging link". The page could not have worked in production, because
 * the credential it authenticated with was a test fixture.
 *
 * It now runs the same `InteractiveHero` the landing page uses. That engine
 * keeps its edits in React state and needs no site, no token and no backend, so
 * there is nothing left that can expire — which is the right shape for a public
 * demo nobody has signed in to. It also means the demo can no longer drift from
 * the one on the landing page, because there is only one of them.
 */

const AFFORDANCES = [
  {
    icon: MousePointerClick,
    title: "Click anything",
    body: "Every headline, paragraph, price and button is editable. There is no edit mode to switch on first.",
  },
  {
    icon: Type,
    title: "Type over it",
    body: "Text edits in place, in the site's own typography. What you see while typing is what the page renders.",
  },
  {
    icon: ImageIcon,
    title: "Swap the photographs",
    body: "Hover any image and shuffle it. The layout holds — replacing a photo cannot break the design around it.",
  },
] as const;

export default function Demo() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="pt-24">
        <section className="px-6 pt-8 pb-12">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
              <MousePointerClick className="h-4 w-4 text-sky-500" />
              <span className="text-sm text-slate-600">
                Nothing to install, nothing to sign up for
              </span>
            </div>

            <h1 className="mb-4 text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
              Edit a real website, right here
            </h1>

            <p className="mx-auto max-w-2xl text-lg leading-relaxed text-slate-600">
              Three customer sites, three different designers. Change any word
              or photograph on any of them and watch it update the way it would
              on your own site.
            </p>
          </div>
        </section>

        {/* The demo itself, on solid white and out of the article measure: these
            are meant to read as whole websites, and boxing them into a text
            column is what stops them doing that. */}
        <section className="border-y border-slate-200 bg-white py-12">
          <div className="mx-auto max-w-[104rem]">
            <InteractiveHero />
          </div>
        </section>

        <section className="px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <div className="grid gap-8 md:grid-cols-3">
              {AFFORDANCES.map(({ icon: Icon, title, body }) => (
                <div key={title}>
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mb-2 text-lg font-semibold text-slate-900">
                    {title}
                  </h2>
                  <p className="text-[15px] leading-relaxed text-slate-600">
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white px-6 py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
              That is the whole product
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-slate-600">
              One script tag on your site turns it into the page you just
              edited. Your developers keep the codebase; everyone else stops
              queueing for copy changes.
            </p>
            <Link
              href="/signup"
              className="pressable group inline-flex items-center gap-2 rounded-full bg-slate-900 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-slate-800"
            >
              <span>Add it to your site</span>
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
