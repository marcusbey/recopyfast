import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { dataFastCtaAttributes } from "@/lib/analytics/datafast-goals";
import type { GuideCtaLinks } from "@/lib/guides/guide-registry";

type GuideCtaProps = {
  links: GuideCtaLinks;
  headingId: string;
};

/**
 * The CTA block at the end of every guide and of /guides (s123). Each anchor
 * is a DataFast `cta_click` (ADR 074) with the page's own location and a
 * target of `owners`, `try` or `signup`, and carries the owner_guides UTMs.
 *
 * /signup is a nonce document (ADR 059): a plain anchor, so the browser makes
 * a full document request and receives that page's CSP. /for/owners and /try
 * are static marketing documents, so Next links are fine.
 */
export function GuideCta({ links, headingId }: GuideCtaProps) {
  return (
    <section aria-labelledby={headingId} className="px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-3xl rounded-3xl bg-sky-100 px-6 py-10 text-center sm:px-12 sm:py-12">
        <h2
          id={headingId}
          className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
        >
          Change your own website words
        </h2>
        <p className="mx-auto mt-4 max-w-xl leading-relaxed text-slate-700">
          If someone else built your site, your developer adds one line, once.
          After that you click the words on your own site, type and publish.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href={links.owners}
            {...dataFastCtaAttributes(links.location, "owners")}
            className="pressable inline-flex max-w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-3.5 text-center font-semibold text-white hover:bg-slate-800"
          >
            How it works for business owners
            <ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0" />
          </Link>
          <Link
            href={links.try}
            {...dataFastCtaAttributes(links.location, "try")}
            className="pressable inline-flex max-w-full items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3.5 text-center font-semibold text-slate-900 hover:border-slate-400"
          >
            Try it on your own site
          </Link>
        </div>
        <p className="mt-6 text-sm text-slate-600">
          Ready already?{" "}
          <a
            href={links.signup}
            data-cta-location={links.location}
            {...dataFastCtaAttributes(links.location, "signup")}
            className="font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-800"
          >
            Start your free trial
          </a>
        </p>
      </div>
    </section>
  );
}
