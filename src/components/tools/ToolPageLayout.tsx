import type { ReactNode } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { serializeJsonLd } from "@/lib/seo/json-ld";

/**
 * The frame of the /tools hub and every tool page (s96): the marketing
 * surface, pinned light (`data-theme="light"`, the /compare and /try pattern),
 * a breadcrumb, the page's own sections, a visible FAQ and the JSON-LD that
 * states it. The FAQ JSON-LD is built from the SAME list rendered here, so the
 * visible copy and the structured copy cannot drift (ADR 032 §5).
 *
 * The only `dangerouslySetInnerHTML` under `src/app/tools` and
 * `src/components/tools` is this JSON-LD, serialised by `serializeJsonLd`
 * (which escapes `<`) from our own constants — never page text from a scan.
 * A source scan pins that.
 */

export interface Crumb {
  name: string;
  /** Omitted on the current page. */
  href?: string;
}

export interface Faq {
  question: string;
  answer: string;
}

export function ToolPageLayout({
  crumbs,
  eyebrow,
  title,
  intro,
  faqs,
  structuredData,
  children,
}: {
  crumbs: readonly Crumb[];
  eyebrow: string;
  title: string;
  intro: ReactNode;
  faqs: readonly Faq[];
  structuredData: readonly object[];
  children: ReactNode;
}) {
  return (
    <div data-theme="light" className="min-h-screen bg-slate-50">
      <Header />
      <main className="pt-24">
        <section className="px-6 pb-8 pt-12 sm:pb-12 sm:pt-20">
          <div className="mx-auto max-w-5xl">
            <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
              {crumbs.map((crumb, index) => (
                <span key={crumb.name}>
                  {index > 0 ? <span aria-hidden="true"> / </span> : null}
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="hover:text-slate-900 hover:underline"
                    >
                      {crumb.name}
                    </Link>
                  ) : (
                    <span aria-current="page">{crumb.name}</span>
                  )}
                </span>
              ))}
            </nav>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
              {eyebrow}
            </p>
            <h1 className="mt-4 max-w-4xl font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
              {title}
            </h1>
            <div className="mt-6 max-w-3xl text-lg leading-relaxed text-slate-700 sm:text-xl">
              {intro}
            </div>
          </div>
        </section>

        {children}

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Frequently asked questions
            </h2>
            <dl className="mt-8 divide-y divide-sky-100 rounded-2xl border border-sky-100 bg-white px-6 shadow-sm sm:px-8">
              {faqs.map((faq) => (
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
          </div>
        </section>

        {structuredData.map((block, index) => (
          <script
            key={index}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(block) }}
          />
        ))}
      </main>
      <Footer />
    </div>
  );
}
