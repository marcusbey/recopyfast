import { ArrowRight } from "lucide-react";
import type { ToolCtaVariant } from "@/lib/tools/catalogue";
import { ctaCopyFor } from "@/lib/tools/cta-copy";
import { dataFastCtaAttributes } from "@/lib/analytics/datafast-goals";

/**
 * The fix CTA on every report and tool page (s96, plan decision 14). Copy is
 * pinned in `src/lib/tools/cta-copy.ts`; this only draws it.
 *
 * Every link is a native `<a>`: `/signup` crosses into the nonce-CSP app
 * surface and must load as a new document (ADR 059,
 * `app-document-boundary-links.test.ts`), and `/try#install` is a fresh
 * document so its anchor lands.
 */
/**
 * DataFast `cta_click` (ADR 074) goes on the signup and /try anchors
 * themselves, not on the section: DataFast counts a click on the element that
 * carries `data-fast-goal`, so on the section every click on the copy would
 * count. The install-guide link is not a signup CTA.
 */
function ctaGoal(href: string) {
  if (href.startsWith("/signup"))
    return dataFastCtaAttributes("tool_cta", "signup");
  if (href.startsWith("/try")) return dataFastCtaAttributes("tool_cta", "try");
  return {};
}

export function ToolCta({
  variant,
  slug,
}: {
  variant: ToolCtaVariant;
  slug: string;
}) {
  const copy = ctaCopyFor(variant, slug);
  const [primary, ...others] = copy.links;
  return (
    <section
      aria-labelledby="tool-cta"
      data-cta-location="tool_cta"
      className="rounded-3xl bg-sky-100 px-7 py-10 sm:px-12"
    >
      <h2
        id="tool-cta"
        className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
      >
        {copy.heading}
      </h2>
      <p className="mt-4 max-w-2xl leading-relaxed text-slate-700">
        {copy.body}
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href={primary.href}
          {...ctaGoal(primary.href)}
          className="pressable inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800"
        >
          {primary.label}
          <ArrowRight aria-hidden="true" className="h-5 w-5" />
        </a>
        {others.map((link) => (
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a
            key={link.href}
            href={link.href}
            {...ctaGoal(link.href)}
            className="pressable inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-900 hover:border-slate-400"
          >
            {link.label}
          </a>
        ))}
      </div>
      {copy.footnote ? (
        <p className="mt-5 text-sm text-slate-600">{copy.footnote}</p>
      ) : null}
    </section>
  );
}
