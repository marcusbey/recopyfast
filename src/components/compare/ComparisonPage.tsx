import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { comparisonList, type Comparison } from "@/lib/compare/comparisons";

type ComparisonPageProps = {
  comparison: Comparison;
};

function faqSchema(comparison: Comparison) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: comparison.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

function BestFitList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-6 space-y-4">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-slate-700">
          <CheckCircle2
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-sky-600"
          />
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function ComparisonPage({ comparison }: ComparisonPageProps) {
  const schema = faqSchema(comparison);

  return (
    <div data-theme="light" className="min-h-screen bg-slate-50">
      <Header />
      <main className="pt-24">
        <section className="px-6 pb-14 pt-12 sm:pb-20 sm:pt-20">
          <div className="mx-auto max-w-5xl">
            <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
              <Link className="hover:text-sky-700" href="/compare">
                Comparisons
              </Link>
              <span aria-hidden="true" className="mx-2">
                /
              </span>
              <span>{comparison.competitor}</span>
            </nav>
            <p className="mt-8 text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
              Website editing comparison
            </p>
            <h1 className="mt-4 max-w-4xl font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
              {comparison.title}
            </h1>
            <p className="mt-6 max-w-3xl text-xl leading-relaxed text-slate-700">
              {comparison.shortAnswer}
            </p>
            <p className="mt-5 text-sm text-slate-500">
              Product information checked as of 2026-09. Official sources are
              linked below.
            </p>
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Side-by-side comparison
            </h2>
            <div
              className="mt-8 max-w-full overflow-x-auto rounded-2xl border border-sky-100 bg-white shadow-sm"
              role="region"
              aria-label="Scrollable comparison table"
              tabIndex={0}
            >
              <table
                className="w-full min-w-[48rem] border-collapse text-left"
                aria-label={`ReCopyFast and ${comparison.competitor} comparison`}
              >
                <thead className="bg-sky-50 text-slate-900">
                  <tr>
                    <th
                      className="w-1/5 px-6 py-4 text-sm font-semibold"
                      scope="col"
                    >
                      Decision
                    </th>
                    <th
                      className="w-2/5 px-6 py-4 text-sm font-semibold"
                      scope="col"
                    >
                      {comparison.competitor}
                    </th>
                    <th
                      className="w-2/5 px-6 py-4 text-sm font-semibold"
                      scope="col"
                    >
                      ReCopyFast
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((row) => (
                    <tr
                      key={row.label}
                      className="border-t border-sky-100 align-top"
                    >
                      <th
                        className="px-6 py-5 text-sm font-semibold text-slate-900"
                        scope="row"
                      >
                        {row.label}
                      </th>
                      <td className="px-6 py-5 text-sm leading-relaxed text-slate-600">
                        {row.competitor}
                      </td>
                      <td className="px-6 py-5 text-sm leading-relaxed text-slate-600">
                        {row.recopyfast}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
            <article className="min-w-0 rounded-2xl border border-sky-100 bg-white p-7 shadow-sm sm:p-9">
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900">
                When to choose {comparison.competitor}
              </h2>
              <BestFitList items={comparison.competitorFit} />
            </article>
            <article className="min-w-0 rounded-2xl border border-sky-200 bg-sky-50 p-7 sm:p-9">
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900">
                When to choose ReCopyFast
              </h2>
              <BestFitList items={comparison.recopyfastFit} />
            </article>
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl rounded-2xl bg-slate-900 p-8 text-white sm:p-10">
            <h2 className="font-display text-3xl font-bold tracking-tight">
              Integration boundaries
            </h2>
            <p className="mt-5 max-w-3xl leading-relaxed text-slate-200">
              {comparison.integrationNote}
            </p>
            <p className="mt-4 max-w-3xl leading-relaxed text-slate-200">
              ReCopyFast can be added across different site stacks because its
              integration is a script, but installation requires permission to
              add a script and a compatible Content Security Policy (CSP). It
              edits existing authored copy; it does not build pages or migrate a
              site.
            </p>
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Pricing context
            </h2>
            <p className="mt-5 max-w-3xl text-lg leading-relaxed text-slate-600">
              As of 2026-09, ReCopyFast Agency is $49/month for 10 sites.
              Founding Agency is $299 lifetime while spots remain. Prices
              checked September 2026; see{" "}
              <Link
                className="font-semibold text-sky-700 hover:text-sky-800"
                href="/#pricing"
              >
                current ReCopyFast pricing
              </Link>{" "}
              for availability and checkout details.
            </p>
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Frequently asked questions
            </h2>
            <dl className="mt-8 divide-y divide-sky-100 rounded-2xl border border-sky-100 bg-white px-6 shadow-sm sm:px-8">
              {comparison.faqs.map((faq) => (
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
                __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
              }}
            />
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              Official sources
            </h2>
            <p className="mt-3 text-sm text-slate-500">
              Checked as of 2026-09.
            </p>
            <ul aria-label="Official sources" className="mt-5 space-y-3">
              {comparison.sources.map((source) => (
                <li key={source.href}>
                  <a
                    className="inline-flex items-center gap-2 font-medium text-sky-700 hover:text-sky-800"
                    href={source.href}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {source.label}
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="px-6 py-16 text-center sm:py-24">
          <div className="mx-auto max-w-3xl rounded-3xl bg-sky-100 px-7 py-12 sm:px-12">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Keep the site. Give clients a simpler editing path.
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
                Try ReCopyFast
              </Link>
            </div>
          </div>
        </section>

        <section className="px-6 pb-20 pt-6">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Related comparisons
            </h2>
            <nav
              aria-label="Related comparisons"
              className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              {comparisonList.map((item) => (
                <Link
                  key={item.slug}
                  href={`/compare/${item.slug}`}
                  aria-current={
                    item.slug === comparison.slug ? "page" : undefined
                  }
                  className="min-w-0 rounded-xl border border-sky-100 bg-white px-5 py-4 font-semibold text-slate-800 hover:border-sky-300 hover:text-sky-800"
                >
                  {item.competitor}
                </Link>
              ))}
            </nav>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
