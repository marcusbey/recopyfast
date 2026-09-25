import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { comparisonList } from "@/lib/compare/comparisons";

const DESCRIPTION =
  "Compare ReCopyFast with Webflow, Duda, TinaCMS, and CloudCannon by workflow, client access, publishing, integration, and pricing model.";

export const metadata: Metadata = {
  title: "Compare website editing tools",
  description: DESCRIPTION,
  alternates: { canonical: "/compare" },
  openGraph: {
    type: "website",
    url: "/compare",
    siteName: "ReCopyFast",
    title: "Compare website editing tools | ReCopyFast",
    description: DESCRIPTION,
    locale: "en_US",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Compare website editing tools | ReCopyFast",
    description: DESCRIPTION,
    images: ["/twitter-image"],
  },
};

const cardDescriptions: Record<
  (typeof comparisonList)[number]["slug"],
  string
> = {
  "webflow-editor":
    "For visual site building, CMS, hosting, and today's content-editor workflow.",
  duda: "For agencies comparing an all-in-one visual builder with an editing layer for existing sites.",
  tinacms:
    "For teams weighing Git-backed structured content against script-based copy editing.",
  cloudcannon:
    "For static-site teams comparing repository sync and visual editing workflows.",
};

const indexFaqs = [
  {
    question: "Which comparison should I read first?",
    answer:
      "Start with the platform closest to your current workflow: Webflow or Duda for visual builders, TinaCMS for structured Git-backed content, and CloudCannon for a Git-based visual CMS.",
  },
  {
    question: "Does ReCopyFast replace a website builder?",
    answer:
      "No. ReCopyFast adds copy editing to an existing site. It does not create layouts, host the site, or migrate the site into a new platform.",
  },
  {
    question: "How current are these comparisons?",
    answer:
      "Product information was checked against official public pricing and documentation in September 2026. Each detailed comparison links its sources.",
  },
] as const;

const indexFaqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: indexFaqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

export default function CompareIndexPage() {
  return (
    <div data-theme="light" className="min-h-screen bg-slate-50">
      <Header />
      <main className="pt-24">
        <section className="px-6 pb-14 pt-12 text-center sm:pb-20 sm:pt-20">
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
              Honest product comparisons
            </p>
            <h1 className="mt-4 font-display text-5xl font-bold tracking-tight text-slate-900 sm:text-6xl">
              Compare website editing tools
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-xl leading-relaxed text-slate-600">
              Start with the workflow you need to preserve. Choose Webflow or
              Duda for visual site building, TinaCMS or CloudCannon for
              Git-backed content workflows, and ReCopyFast for adding client
              copy editing to an existing site without migration.
            </p>
            <p className="mt-5 text-sm text-slate-500">
              Product information checked as of 2026-09. Official sources are
              linked from each detailed comparison.
            </p>
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-2">
            {comparisonList.map((comparison) => (
              <article
                key={comparison.slug}
                className="min-w-0 rounded-2xl border border-sky-100 bg-white p-7 shadow-sm sm:p-8"
              >
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  {comparison.competitor}
                </h2>
                <p className="mt-3 leading-relaxed text-slate-600">
                  {cardDescriptions[comparison.slug]}
                </p>
                <Link
                  className="mt-6 inline-flex items-center gap-2 font-semibold text-sky-700 hover:text-sky-800"
                  href={`/compare/${comparison.slug}`}
                >
                  Compare {comparison.competitor}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Compare the workflows
            </h2>
            <p className="mt-4 text-sm text-slate-500">
              Each detailed comparison links the official public pricing and
              documentation used.
            </p>
            <div
              className="mt-8 max-w-full overflow-x-auto rounded-2xl border border-sky-100 bg-white shadow-sm"
              role="region"
              aria-label="Scrollable comparison overview"
              tabIndex={0}
            >
              <table
                className="w-full min-w-[44rem] border-collapse text-left"
                aria-label="Website editing options comparison"
              >
                <thead className="bg-sky-50 text-slate-900">
                  <tr>
                    <th className="px-6 py-4 text-sm font-semibold" scope="col">
                      Option
                    </th>
                    <th className="px-6 py-4 text-sm font-semibold" scope="col">
                      Best fit
                    </th>
                    <th className="px-6 py-4 text-sm font-semibold" scope="col">
                      Integration model
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonList.map((comparison) => (
                    <tr
                      key={comparison.slug}
                      className="border-t border-sky-100 align-top"
                    >
                      <th
                        className="px-6 py-5 text-sm font-semibold text-slate-900"
                        scope="row"
                      >
                        {comparison.competitor}
                      </th>
                      <td className="px-6 py-5 text-sm leading-relaxed text-slate-600">
                        {comparison.rows[0].competitor}
                      </td>
                      <td className="px-6 py-5 text-sm leading-relaxed text-slate-600">
                        {comparison.rows[1].competitor}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-sky-100 align-top">
                    <th
                      className="px-6 py-5 text-sm font-semibold text-slate-900"
                      scope="row"
                    >
                      ReCopyFast
                    </th>
                    <td className="px-6 py-5 text-sm leading-relaxed text-slate-600">
                      Focused copy editing for an existing site.
                    </td>
                    <td className="px-6 py-5 text-sm leading-relaxed text-slate-600">
                      Add one script, subject to script access and a compatible
                      Content Security Policy.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
            <article className="min-w-0 rounded-2xl border border-sky-100 bg-white p-7 shadow-sm sm:p-9">
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900">
                When to choose a platform
              </h2>
              <p className="mt-5 leading-relaxed text-slate-600">
                Choose a full platform when you need its wider system: visual
                layout and hosting from Webflow or Duda, structured Git content
                from TinaCMS, or a Git-based visual CMS and repository sync from
                CloudCannon.
              </p>
            </article>
            <article className="min-w-0 rounded-2xl border border-sky-200 bg-sky-50 p-7 sm:p-9">
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900">
                When to choose ReCopyFast
              </h2>
              <p className="mt-5 leading-relaxed text-slate-700">
                Choose ReCopyFast when the site already exists, should stay on
                its current stack, and clients need an account-free email-code
                path to draft and publish copy.
              </p>
            </article>
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Frequently asked questions
            </h2>
            <dl className="mt-8 divide-y divide-sky-100 rounded-2xl border border-sky-100 bg-white px-6 shadow-sm sm:px-8">
              {indexFaqs.map((faq) => (
                <div key={faq.question} className="py-6">
                  <dt className="text-lg font-semibold text-slate-900">
                    {faq.question}
                  </dt>
                  <dd className="mt-3 leading-relaxed text-slate-600">
                    {faq.answer}
                  </dd>
                </div>
              ))}
            </dl>
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify(indexFaqSchema).replace(/</g, "\\u003c"),
              }}
            />
          </div>
        </section>

        <section className="px-6 py-16 text-center sm:py-24">
          <div className="mx-auto max-w-3xl rounded-3xl bg-sky-100 px-7 py-12 sm:px-12">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Add client editing without rebuilding the site
            </h2>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/signup"
                className="pressable inline-flex items-center gap-2 rounded-full bg-slate-900 px-7 py-3.5 font-semibold text-white hover:bg-slate-800"
              >
                Start with ReCopyFast
                <ArrowRight aria-hidden="true" className="h-5 w-5" />
              </Link>
              <Link
                href="/try"
                className="pressable inline-flex items-center rounded-full border border-slate-300 bg-white px-7 py-3.5 font-semibold text-slate-900 hover:border-slate-400"
              >
                Try it on a site
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
