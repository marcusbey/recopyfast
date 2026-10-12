import type { Metadata } from "next";
import { CodeBlock } from "@/components/ui/code-block";
import { ToolCard } from "@/components/tools/ToolCard";
import { ToolPageLayout } from "@/components/tools/ToolPageLayout";
import {
  buildBreadcrumbListLd,
  buildFAQPageLd,
  buildWebApplicationLd,
} from "@/lib/seo/json-ld";
import { SITE_NAME } from "@/lib/seo/site-identity";
import { resolveSiteUrl } from "@/lib/seo/site-url";
import { TOOL_CATALOGUE, type ToolEntry } from "@/lib/tools/catalogue";
import {
  ABOUT_SCANNER,
  HUB_DESCRIPTION,
  HUB_FAQS,
  HUB_PATH,
  HUB_TITLE,
  SCANNER_ROBOTS_RULE,
} from "@/lib/tools/pages-copy";

/*
 * Static (s96): the catalogue is typed data, fixed at build time. Served under
 * the marketing CSP like /compare; no cookies, no headers, no dynamic APIs.
 */

const TITLE = `${HUB_TITLE} | ${SITE_NAME}`;

export const metadata: Metadata = {
  title: HUB_TITLE,
  description: HUB_DESCRIPTION,
  alternates: { canonical: HUB_PATH },
  openGraph: {
    type: "website",
    url: HUB_PATH,
    siteName: SITE_NAME,
    title: TITLE,
    description: HUB_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: HUB_DESCRIPTION,
  },
};

export function ToolsHubContent({ tools }: { tools: readonly ToolEntry[] }) {
  const siteUrl = resolveSiteUrl();
  const pageUrl = `${siteUrl}${HUB_PATH}`;

  return (
    <ToolPageLayout
      crumbs={[{ name: "Home", href: "/" }, { name: "Free tools" }]}
      eyebrow="Free tools"
      title={HUB_TITLE}
      intro={
        <p>
          Enter a website address and get a report you can share, with every
          finding shown where it sits on the page. No account needed.
        </p>
      }
      faqs={HUB_FAQS}
      structuredData={[
        buildWebApplicationLd({
          url: pageUrl,
          name: HUB_TITLE,
          description: HUB_DESCRIPTION,
        }),
        buildBreadcrumbListLd([
          { name: "Home", url: siteUrl },
          { name: "Free tools", url: pageUrl },
        ]),
        buildFAQPageLd(HUB_FAQS),
      ]}
    >
      <section className="px-6 py-8 sm:py-12">
        <div className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-2">
          {tools.map((tool) => (
            <ToolCard key={tool.slug} tool={tool} />
          ))}
        </div>
      </section>

      <section id="about-our-scanner" className="px-6 py-12 sm:py-16">
        <div className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-7 sm:p-9">
          <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900">
            About our scanner
          </h2>
          <div className="mt-5 space-y-4 leading-relaxed text-slate-700">
            <p>{ABOUT_SCANNER.fetched}</p>
            <p>{ABOUT_SCANNER.identity}</p>
            <p>{ABOUT_SCANNER.stored}</p>
            <p>{ABOUT_SCANNER.optOut}</p>
          </div>
          <CodeBlock
            className="mt-4"
            label="robots.txt"
            value={SCANNER_ROBOTS_RULE}
            copyLabel="Copy the robots.txt rule"
          />
        </div>
      </section>
    </ToolPageLayout>
  );
}

export default function ToolsHubPage() {
  return <ToolsHubContent tools={TOOL_CATALOGUE} />;
}
