import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { TryExperience } from "@/components/try/TryExperience";

const DESCRIPTION =
  "Preview ReCopyFast on any live website in one click. Edit locally in your tab without registering, installing or saving anything.";

export const metadata: Metadata = {
  title: "See your site editable in one click",
  description: DESCRIPTION,
  alternates: { canonical: "/try" },
  openGraph: {
    type: "website",
    url: "/try",
    title: "See your site editable in one click | ReCopyFast",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "See your site editable in one click | ReCopyFast",
    description: DESCRIPTION,
  },
};

export default function TryPage() {
  return (
    <div data-theme="light" className="min-h-screen bg-slate-50">
      <Header />
      <main className="pt-24">
        <section className="px-6 pb-16 pt-12 text-center sm:pb-20 sm:pt-20">
          <div className="mx-auto max-w-4xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
              <ShieldCheck
                className="h-4 w-4 text-sky-600"
                aria-hidden="true"
              />
              <span className="text-sm text-slate-600">
                No account, install or saved changes
              </span>
            </div>
            <h1 className="font-display text-5xl font-bold tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
              See your site editable in one click
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
              Open a client site, click one bookmark and edit its copy in the
              page. Everything stays in this tab. Nothing is saved to the site.
            </p>
          </div>
        </section>

        <TryExperience />

        <section className="px-6 py-20 text-center sm:py-24">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Ready to make the edits real?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-slate-600">
              Add ReCopyFast to your site, invite your team and start publishing
              edits.
            </p>
            <Link
              href="/signup?utm_source=try&utm_medium=page&utm_campaign=try_on_any_site"
              className="pressable group mt-8 inline-flex items-center gap-2 rounded-full bg-slate-900 px-8 py-4 text-base font-semibold text-white transition-[background-color,transform] hover:bg-slate-800"
            >
              Start your free trial
              <ArrowRight
                className="h-5 w-5 transition-transform group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
