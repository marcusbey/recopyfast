import Link from "next/link";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { GuideCta } from "@/components/guides/GuideCta";
import { GuideRichText } from "@/components/guides/GuideRichText";
import {
  GUIDES_PATH,
  guideCtaLinks,
  guidePath,
  guideSiteUrl,
  type Guide,
  type GuideBlock,
} from "@/lib/guides/guide-registry";
import { GUIDE_DELIVERY_SOURCE, getGuide } from "@/lib/guides/guides";
import {
  buildArticleLd,
  buildBreadcrumbListLd,
  buildFAQPageLd,
  serializeJsonLd,
} from "@/lib/seo/json-ld";
import { SITE_NAME } from "@/lib/seo/site-identity";
import { resolveSiteUrl } from "@/lib/seo/site-url";

type GuidePageProps = {
  guide: Guide;
};

function formatReviewedOn(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p className="mt-5 leading-relaxed text-slate-700">
          <GuideRichText text={block.text} />
        </p>
      );
    case "note":
      return (
        <p className="mt-5 rounded-xl border border-sky-100 bg-sky-50 px-5 py-4 text-sm leading-relaxed text-slate-700">
          <GuideRichText text={block.text} />
        </p>
      );
    case "steps":
      return (
        <ol className="mt-5 list-decimal space-y-3 pl-6 leading-relaxed text-slate-700 marker:font-semibold marker:text-sky-700">
          {block.items.map((item, index) => (
            <li key={index} className="pl-1">
              <GuideRichText text={item} />
            </li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="mt-5 list-disc space-y-3 pl-6 leading-relaxed text-slate-700 marker:text-sky-600">
          {block.items.map((item, index) => (
            <li key={index} className="pl-1">
              <GuideRichText text={item} />
            </li>
          ))}
        </ul>
      );
    case "checklist":
      return (
        <ul className="mt-5 space-y-3">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-3 text-slate-700">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 text-sky-600"
              />
              <span className="min-w-0 leading-relaxed">
                <GuideRichText text={item} />
              </span>
            </li>
          ))}
        </ul>
      );
  }
}

/**
 * One owner guide (s123), on the Marketing surface like the comparison
 * pages (ADR 020): sky/slate palette, pinned light, no client components of
 * its own, so the page is fully static and stays inside ADR 013's budget.
 *
 * The "How ReCopyFast works" note under every guide is template copy, not
 * per-guide data, so no single guide can drop the delivery caveat: published
 * edits are applied after load, crawlers that don't run JavaScript see the
 * original HTML (llms-txt.ts, /for/owners FAQ), and a redesign can stop an
 * edit showing without a warning until PR #119's detector ships.
 */
export function GuidePage({ guide }: GuidePageProps) {
  const url = guideSiteUrl(guidePath(guide.slug));
  const article = buildArticleLd({
    headline: guide.title,
    description: guide.description,
    url,
    dateModified: guide.reviewedOn,
    publisherName: SITE_NAME,
    publisherUrl: guideSiteUrl("/"),
  });
  const breadcrumbs = buildBreadcrumbListLd([
    { name: "Home", url: resolveSiteUrl() },
    { name: "Guides", url: guideSiteUrl(GUIDES_PATH) },
    { name: guide.title, url },
  ]);
  const faqSchema = buildFAQPageLd(guide.faqs);
  const related = guide.related
    .map((slug) => getGuide(slug))
    .filter((item): item is Guide => item !== null);

  return (
    <div data-theme="light" className="min-h-screen bg-slate-50">
      <Header />
      <main className="pt-24">
        <article>
          <header className="px-6 pb-10 pt-12 sm:pb-14 sm:pt-20">
            <div className="mx-auto max-w-3xl">
              <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
                <Link className="hover:text-sky-700" href={GUIDES_PATH}>
                  Guides for owners
                </Link>
                <span aria-hidden="true" className="mx-2">
                  /
                </span>
                <span aria-current="page">{guide.title}</span>
              </nav>
              <p className="mt-8 text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
                Guide for business owners
              </p>
              <h1 className="mt-4 font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
                {guide.title}
              </h1>
              <div className="mt-8 rounded-2xl border border-sky-200 bg-white p-6 shadow-sm sm:p-7">
                <p className="text-sm font-semibold uppercase tracking-[0.12em] text-sky-700">
                  The short answer
                </p>
                <p className="mt-3 text-lg leading-relaxed text-slate-800">
                  {guide.shortAnswer}
                </p>
              </div>
              <p className="mt-5 text-sm text-slate-500">
                Checked against the linked sources on{" "}
                <time dateTime={guide.reviewedOn}>
                  {formatReviewedOn(guide.reviewedOn)}
                </time>
                .
              </p>
              <nav
                aria-label="On this page"
                className="mt-8 rounded-2xl border border-sky-100 bg-white p-6"
              >
                <p className="text-sm font-semibold text-slate-900">
                  On this page
                </p>
                <ul className="mt-3 space-y-2 text-sm">
                  {guide.sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="text-sky-700 hover:text-sky-800"
                      >
                        {section.heading}
                      </a>
                    </li>
                  ))}
                  <li>
                    <a
                      href="#where-recopyfast-fits"
                      className="text-sky-700 hover:text-sky-800"
                    >
                      Where ReCopyFast fits
                    </a>
                  </li>
                </ul>
              </nav>
            </div>
          </header>

          {guide.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-heading`}
              className="scroll-mt-24 px-6 py-8 sm:py-10"
            >
              <div className="mx-auto max-w-3xl">
                <h2
                  id={`${section.id}-heading`}
                  className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
                >
                  {section.heading}
                </h2>
                {section.blocks.map((block, index) => (
                  <Block key={index} block={block} />
                ))}
              </div>
            </section>
          ))}

          <section
            id="where-recopyfast-fits"
            aria-labelledby="where-recopyfast-fits-heading"
            className="scroll-mt-24 px-6 py-8 sm:py-10"
          >
            <div className="mx-auto max-w-3xl rounded-2xl border border-sky-200 bg-sky-50 p-6 sm:p-8">
              <h2
                id="where-recopyfast-fits-heading"
                className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
              >
                Where ReCopyFast fits
              </h2>
              {guide.recopyfastFit.map((text, index) => (
                <p key={index} className="mt-4 leading-relaxed text-slate-700">
                  <GuideRichText text={text} />
                </p>
              ))}
              <h3 className="mt-6 text-lg font-semibold text-slate-900">
                How it works, honestly
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-700">
                You can change existing words and swap existing photos, not the
                layout, new pages, forms or code. Published changes are applied
                in the visitor&apos;s browser just after the page loads, so the
                original text can show for a moment first. Google can run
                JavaScript when it indexes pages (
                <a
                  href={GUIDE_DELIVERY_SOURCE.href}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-800"
                >
                  {GUIDE_DELIVERY_SOURCE.label}
                </a>
                ), but Google also notes that not all bots can run JavaScript,
                and those see the original text, so keep your main headline and
                key search text in the site itself. We don&apos;t promise any
                SEO benefit. If your developer later moves things around or
                redesigns a page, some of your changes can stop showing, and we
                don&apos;t warn you about that yet.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="guide-faq-heading"
            className="px-6 py-10 sm:py-12"
          >
            <div className="mx-auto max-w-3xl">
              <h2
                id="guide-faq-heading"
                className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
              >
                Questions owners ask
              </h2>
              <dl className="mt-6 divide-y divide-sky-100 rounded-2xl border border-sky-100 bg-white px-6 shadow-sm">
                {guide.faqs.map((faq) => (
                  <div key={faq.question} className="py-5">
                    <dt className="font-semibold text-slate-900">
                      {faq.question}
                    </dt>
                    <dd className="mt-2 leading-relaxed text-slate-600">
                      {faq.answer}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section
            aria-labelledby="guide-sources-heading"
            className="px-6 py-8"
          >
            <div className="mx-auto max-w-3xl">
              <h2
                id="guide-sources-heading"
                className="font-display text-xl font-bold text-slate-900"
              >
                Sources
              </h2>
              <ul aria-label="Sources" className="mt-4 space-y-2">
                {guide.sources.map((source) => (
                  <li key={source.href}>
                    <a
                      className="inline-flex items-start gap-2 text-sm font-medium text-sky-700 hover:text-sky-800"
                      href={source.href}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <span className="min-w-0">{source.label}</span>
                      <ExternalLink
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </article>

        <GuideCta
          links={guideCtaLinks(guide.slug)}
          headingId="guide-cta-heading"
        />

        <section
          aria-labelledby="related-guides-heading"
          className="px-6 pb-20 pt-2"
        >
          <div className="mx-auto max-w-3xl">
            <h2
              id="related-guides-heading"
              className="font-display text-xl font-bold text-slate-900"
            >
              Related guides
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {related.map((item) => (
                <li key={item.slug} className="min-w-0">
                  <Link
                    href={guidePath(item.slug)}
                    className="block h-full rounded-xl border border-sky-100 bg-white px-5 py-4 font-semibold text-slate-800 hover:border-sky-300 hover:text-sky-800"
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(article) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbs) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqSchema) }}
        />
      </main>
      <Footer />
    </div>
  );
}
