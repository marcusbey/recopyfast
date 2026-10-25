import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { GuideCta } from "@/components/guides/GuideCta";
import {
  GUIDES_INDEX_CTA,
  GUIDES_PATH,
  guidePath,
  guideSiteUrl,
  type Guide,
} from "@/lib/guides/guide-registry";
import { guideList } from "@/lib/guides/guides";
import { buildBreadcrumbListLd, serializeJsonLd } from "@/lib/seo/json-ld";
import { SITE_NAME } from "@/lib/seo/site-identity";
import { resolveSiteUrl } from "@/lib/seo/site-url";

const TITLE = "Website guides for business owners";
const DESCRIPTION =
  "Plain answers for business owners: update your hours and prices, edit WordPress text safely, and edit a website someone else built.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: GUIDES_PATH },
  openGraph: {
    type: "website",
    url: GUIDES_PATH,
    siteName: SITE_NAME,
    title: `${TITLE} | ${SITE_NAME}`,
    description: DESCRIPTION,
    locale: "en_US",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | ${SITE_NAME}`,
    description: DESCRIPTION,
    images: ["/twitter-image"],
  },
};

type GuidesIndexContentProps = {
  guides: readonly Guide[];
};

export function GuidesIndexContent({ guides }: GuidesIndexContentProps) {
  const breadcrumbs = buildBreadcrumbListLd([
    { name: "Home", url: resolveSiteUrl() },
    { name: "Guides", url: guideSiteUrl(GUIDES_PATH) },
  ]);

  return (
    <div data-theme="light" className="min-h-screen bg-slate-50">
      <Header />
      <main className="pt-24">
        <section className="px-6 pb-12 pt-12 text-center sm:pb-16 sm:pt-20">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
              Guides for owners
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
              {TITLE}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
              The website jobs owners ask about most: hours, prices, WordPress
              text and sites someone else built. Each guide starts with the
              answer, goes platform by platform, and says plainly when you
              don&apos;t need us.
            </p>
          </div>
        </section>

        <section aria-label="All guides" className="px-6 pb-8">
          <ul className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-2">
            {guides.map((guide) => (
              <li
                key={guide.slug}
                className="min-w-0 rounded-2xl border border-sky-100 bg-white p-7 shadow-sm"
              >
                <h2 className="font-display text-xl font-bold text-slate-900 sm:text-2xl">
                  {guide.title}
                </h2>
                <p className="mt-3 leading-relaxed text-slate-600">
                  {guide.hubDescription}
                </p>
                <Link
                  className="mt-5 inline-flex items-center gap-2 font-semibold text-sky-700 hover:text-sky-800"
                  href={guidePath(guide.slug)}
                  aria-label={`Read the guide: ${guide.title}`}
                >
                  Read the guide
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <GuideCta links={GUIDES_INDEX_CTA} headingId="guides-cta-heading" />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbs) }}
        />
      </main>
      <Footer />
    </div>
  );
}

export default function GuidesIndexPage() {
  return <GuidesIndexContent guides={guideList} />;
}
