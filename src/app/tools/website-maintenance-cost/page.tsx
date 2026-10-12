import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { CostCalculator } from "@/components/tools/maintenance-cost/CostCalculator";
import {
  buildBreadcrumbListLd,
  buildFAQPageLd,
  buildWebApplicationLd,
  serializeJsonLd,
} from "@/lib/seo/json-ld";
import { SITE_NAME } from "@/lib/seo/site-identity";
import { resolveSiteUrl } from "@/lib/seo/site-url";
import {
  CTA_BODY,
  CTA_HEADING,
  EYEBROW,
  FAQS,
  INTRO,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  SIGNUP_CTA_LABEL,
  TOOL_NAME,
  TOOL_PATH,
  TRY_CTA_LABEL,
  TRY_CTA_NOTE,
} from "@/lib/tools/maintenance-cost/copy";

/*
 * Static on purpose. The calculator reads the URL with `useSearchParams`,
 * which opts a route into dynamic rendering unless it sits under a Suspense
 * boundary; the boundary below keeps this page prerendered (`○` in the build's
 * route table). Do not add `dynamic`, `cookies()` or `headers()` here.
 * The origin for the pasted card is read on the server for the same reason a
 * preview deployment must not hand out its own host: see embed-snippet.ts.
 */

const TITLE = `${PAGE_TITLE} | ${SITE_NAME}`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: TOOL_PATH },
  openGraph: {
    type: "website",
    url: TOOL_PATH,
    siteName: SITE_NAME,
    title: TITLE,
    description: PAGE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: PAGE_DESCRIPTION,
  },
};

export default function WebsiteMaintenanceCostPage() {
  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}${TOOL_PATH}`;

  // The middle "Free tools" crumb joined when s96 shipped /tools.
  const structuredData = [
    buildWebApplicationLd({
      url: pageUrl,
      name: TOOL_NAME,
      description: PAGE_DESCRIPTION,
    }),
    buildBreadcrumbListLd([
      { name: "Home", url: siteUrl },
      { name: "Free tools", url: `${siteUrl}/tools` },
      { name: TOOL_NAME, url: pageUrl },
    ]),
    buildFAQPageLd(FAQS),
  ];

  return (
    <div data-theme="light" className="min-h-screen bg-slate-50">
      <Header />
      <main className="pt-24">
        <section className="px-6 pb-8 pt-12 sm:pb-12 sm:pt-20">
          <div className="mx-auto max-w-5xl">
            <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900 hover:underline">
                Home
              </Link>
              <span aria-hidden="true"> / </span>
              <Link
                href="/tools"
                className="hover:text-slate-900 hover:underline"
              >
                Free tools
              </Link>
              <span aria-hidden="true"> / </span>
              <span aria-current="page">{TOOL_NAME}</span>
            </nav>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
              {EYEBROW}
            </p>
            <h1 className="mt-4 max-w-4xl font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
              {PAGE_TITLE}
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-relaxed text-slate-700 sm:text-xl">
              {INTRO}
            </p>
          </div>
        </section>

        <section className="px-6 py-8 sm:py-12">
          <div className="mx-auto max-w-5xl">
            <Suspense fallback={null}>
              <CostCalculator siteOrigin={siteUrl} />
            </Suspense>
          </div>
        </section>

        <section className="px-6 py-12 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Frequently asked questions
            </h2>
            <dl className="mt-8 divide-y divide-sky-100 rounded-2xl border border-sky-100 bg-white px-6 shadow-sm sm:px-8">
              {FAQS.map((faq) => (
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

        <section className="px-6 py-12 text-center sm:py-20">
          <div className="mx-auto max-w-3xl rounded-3xl bg-sky-100 px-7 py-12 sm:px-12">
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              {CTA_HEADING}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-slate-700">
              {CTA_BODY}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              {/* Keep attribution intact while establishing /signup's nonce
                  policy through a full document request (ADR 059). */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/signup?utm_source=tools&utm_medium=free_tool&utm_campaign=website-maintenance-cost"
                data-cta-location="tool_page"
                className="pressable inline-flex items-center gap-2 rounded-full bg-slate-900 px-7 py-3.5 font-semibold text-white hover:bg-slate-800"
              >
                {SIGNUP_CTA_LABEL}
                <ArrowRight aria-hidden="true" className="h-5 w-5" />
              </a>
              <Link
                href="/try?utm_source=tools&utm_medium=free_tool&utm_campaign=website-maintenance-cost#install"
                className="pressable inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-7 py-3.5 font-semibold text-slate-900 hover:border-slate-400"
              >
                {TRY_CTA_LABEL}
                <span className="font-normal text-slate-600">
                  {TRY_CTA_NOTE}
                </span>
              </Link>
            </div>
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
