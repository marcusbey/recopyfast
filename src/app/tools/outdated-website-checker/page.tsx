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
import { OUTDATED_TOOL_SLUG } from "@/lib/tools/lenses/outdated/outdated-lens";

const TOOL_PATH = "/tools/outdated-website-checker";
const HUB_PATH = "/tools";
const TOOL_TITLE = "Is your website out of date?";
const DESCRIPTION =
  "Check up to ten public pages for dates, prices and promotions that may have passed. Each result shows the exact line and why it was flagged.";
const TITLE = `${TOOL_TITLE} — free outdated website checker | ${SITE_NAME}`;

export const metadata: Metadata = {
  title: `${TOOL_TITLE} — free outdated website checker`,
  description: DESCRIPTION,
  alternates: { canonical: TOOL_PATH },
  openGraph: {
    type: "website",
    url: TOOL_PATH,
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const CHECKS = [
  "Copyright years behind the current year.",
  "Past dates still described as upcoming, bookable or a deadline.",
  "Year-stamped prices, rates, menus and schedules.",
  "“Coming”, “opening” or “launching” in a past year.",
  "Past-year and clearly out-of-season promotions.",
  "“Last updated” labels more than two calendar years old, shown as information.",
] as const;

const LEAVES_ALONE = [
  "Blog and publication dates without future/deadline wording.",
  "Historical copy such as “since 2015” or “founded in 2015”.",
  "Numeric slash dates such as 03/04/2025.",
  "Non-English pages and copy added only after JavaScript runs.",
] as const;

const FAQS = [
  {
    question: "Which pages does it check?",
    answer:
      "Your homepage plus up to nine public pages on the same host, taken from the sitemap or homepage links.",
  },
  {
    question: "Does every old date mean the page is outdated?",
    answer:
      "No. A date is flagged only when nearby wording still presents it as upcoming, bookable, a deadline, a current price or a promotion. Blog dates and company history are left alone.",
  },
  {
    question: "How are month-only dates treated?",
    answer:
      "A month such as “October 2026” is not past until that month has ended in UTC.",
  },
  {
    question: "Does it read text added by JavaScript?",
    answer:
      "No. It reads the HTML the server sends. Pages or lines not present there cannot be checked.",
  },
  {
    question: "Does it check other languages?",
    answer:
      "No. A page that declares another language, or whose prose does not look English, is listed as not checked.",
  },
] as const;

/** Static marketing-CSP document; successful scans enter a nonce report. */
export default function OutdatedWebsiteCheckerPage() {
  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}${TOOL_PATH}`;

  return (
    <ToolPageLayout
      crumbs={[
        { name: "Home", href: "/" },
        { name: "Free tools", href: HUB_PATH },
        { name: TOOL_TITLE },
      ]}
      eyebrow="Free tool"
      title={TOOL_TITLE}
      intro={<p>{DESCRIPTION}</p>}
      faqs={FAQS}
      structuredData={[
        buildWebApplicationLd({
          url: pageUrl,
          name: TOOL_TITLE,
          description: DESCRIPTION,
        }),
        buildBreadcrumbListLd([
          { name: "Home", url: siteUrl },
          { name: "Free tools", url: `${siteUrl}${HUB_PATH}` },
          { name: TOOL_TITLE, url: pageUrl },
        ]),
        buildFAQPageLd(FAQS),
      ]}
    >
      <section className="px-6 py-6 sm:py-8">
        <div className="mx-auto max-w-5xl">
          <ToolScanForm
            tool={OUTDATED_TOOL_SLUG}
            submitLabel="Check for outdated copy"
          />
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
            <p className="mt-6 border-l-4 border-sky-600 bg-sky-50 px-4 py-3 leading-relaxed text-slate-700">
              It checks the HTML as sent by the server. JavaScript is not run.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              A warning means “review this line”, not “the page is wrong”.
            </p>
          </article>
        </div>
      </section>
    </ToolPageLayout>
  );
}
