import type { Metadata } from "next";
import { ToolPageLayout } from "@/components/tools/ToolPageLayout";
import { ToolScanForm } from "@/components/tools/ToolScanForm";
import {
  buildBreadcrumbListLd,
  buildFAQPageLd,
  buildWebApplicationLd,
} from "@/lib/seo/json-ld";
import { SITE_NAME } from "@/lib/seo/site-identity";
import { resolveSiteUrl } from "@/lib/seo/site-url";
import {
  HUB_PATH,
  TYPO_DESCRIPTION,
  TYPO_FAQS,
  TYPO_PATH,
  TYPO_SLUG,
  TYPO_SUBMIT_LABEL,
  TYPO_TITLE,
} from "@/lib/tools/pages-copy";

/*
 * Static (s96): prerendered under the marketing CSP. The scan runs in
 * POST /api/tools/scan; the form then loads the report as a new document,
 * which is served under the nonce CSP (ADR 062).
 */

const TITLE = `${TYPO_TITLE} — free website spell checker | ${SITE_NAME}`;

export const metadata: Metadata = {
  title: `${TYPO_TITLE} — free website spell checker`,
  description: TYPO_DESCRIPTION,
  alternates: { canonical: TYPO_PATH },
  openGraph: {
    type: "website",
    url: TYPO_PATH,
    siteName: SITE_NAME,
    title: TITLE,
    description: TYPO_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: TYPO_DESCRIPTION,
  },
};

const CHECKS = [
  "Likely misspellings: a word that is one letter away from a common English word, with the word it probably meant.",
  "Doubled words, like “the the”.",
  "Your homepage and up to nine more pages, with each finding shown in its sentence.",
];

const LEAVES_ALONE = [
  "Words written with a capital letter, like names and brands, and words in ALL CAPS.",
  "Short lines such as menus, buttons and name cards.",
  "Words your site uses three or more times, and words in your page titles, site name and address.",
  "Web addresses, email addresses and file names.",
  "Pages in other languages, which are reported as not checked.",
];

export default function WebsiteSpellCheckerPage() {
  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}${TYPO_PATH}`;

  return (
    <ToolPageLayout
      crumbs={[
        { name: "Home", href: "/" },
        { name: "Free tools", href: HUB_PATH },
        { name: TYPO_TITLE },
      ]}
      eyebrow="Free tool"
      title={TYPO_TITLE}
      intro={
        <p>
          Paste your website&apos;s address. We read your homepage and up to
          nine more of its public pages, then show each likely typo in the
          sentence it sits in, in a report you can share.
        </p>
      }
      faqs={TYPO_FAQS}
      structuredData={[
        buildWebApplicationLd({
          url: pageUrl,
          name: TYPO_TITLE,
          description: TYPO_DESCRIPTION,
        }),
        buildBreadcrumbListLd([
          { name: "Home", url: siteUrl },
          { name: "Free tools", url: `${siteUrl}${HUB_PATH}` },
          { name: TYPO_TITLE, url: pageUrl },
        ]),
        buildFAQPageLd(TYPO_FAQS),
      ]}
    >
      <section className="px-6 py-6 sm:py-8">
        <div className="mx-auto max-w-5xl">
          <ToolScanForm tool={TYPO_SLUG} submitLabel={TYPO_SUBMIT_LABEL} />
        </div>
      </section>

      <section className="px-6 py-12 sm:py-16">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
          <article className="min-w-0 rounded-2xl border border-sky-100 bg-white p-7 shadow-sm sm:p-9">
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              What it checks
            </h2>
            <ul className="mt-5 list-disc space-y-3 pl-5 leading-relaxed text-slate-600">
              {CHECKS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </article>
          <article className="min-w-0 rounded-2xl border border-sky-100 bg-white p-7 shadow-sm sm:p-9">
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              What it leaves alone
            </h2>
            <ul className="mt-5 list-disc space-y-3 pl-5 leading-relaxed text-slate-600">
              {LEAVES_ALONE.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>
    </ToolPageLayout>
  );
}
