import { ArrowRight } from "lucide-react";
import { ownerCtaCopyFor } from "@/lib/tools/cta-copy";
import {
  dataFastCtaAttributes,
  dataFastToolResultLocation,
  type DataFastCtaTarget,
} from "@/lib/analytics/datafast-goals";

/**
 * The owner next step under a free tool's result (s121): "try it on your
 * site" (`/try`) and "how it works for business owners" (`/for/owners`).
 * Copy lives in `src/lib/tools/cta-copy.ts`.
 *
 * `primary` when the result surfaced something to fix: it is drawn as the
 * page's main call to action and sits above the existing fix CTA. Otherwise
 * it is a quieter card that never competes with the tool's own CTA.
 *
 * Native `<a>`, like `ToolCta`: it renders on report documents (nonce CSP),
 * and `/try#install` must load as a new document for its anchor to land.
 * DataFast `cta_click` (ADR 074) sits on each anchor, location
 * `<tool>_result`, target `try` or `owners`.
 */
export function OwnerNextStep({
  slug,
  hasIssues,
  emphasis,
}: {
  slug: string;
  hasIssues: boolean;
  emphasis: "primary" | "secondary";
}) {
  const copy = ownerCtaCopyFor(slug, hasIssues);
  const location = dataFastToolResultLocation(slug);
  const goal = (target: DataFastCtaTarget) =>
    location ? dataFastCtaAttributes(location, target) : {};
  const [tryLink, ownersLink] = copy.links;
  const isPrimary = emphasis === "primary";

  return (
    <section
      aria-labelledby={`owner-next-step-${slug}`}
      data-cta-location={location}
      className={
        isPrimary
          ? "rounded-3xl bg-slate-900 px-7 py-10 text-white sm:px-12"
          : "rounded-3xl border border-slate-200 bg-white px-7 py-8 sm:px-10"
      }
    >
      <h2
        id={`owner-next-step-${slug}`}
        className={
          isPrimary
            ? "font-display text-2xl font-bold tracking-tight sm:text-3xl"
            : "font-display text-xl font-bold tracking-tight text-slate-900"
        }
      >
        {copy.heading}
      </h2>
      <p
        className={
          isPrimary
            ? "mt-4 max-w-2xl leading-relaxed text-slate-200"
            : "mt-3 max-w-2xl leading-relaxed text-slate-700"
        }
      >
        {copy.body}
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href={tryLink.href}
          {...goal("try")}
          className={
            isPrimary
              ? "pressable inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 font-semibold text-slate-900 hover:bg-slate-100"
              : "pressable inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800"
          }
        >
          {tryLink.label}
          <ArrowRight aria-hidden="true" className="h-5 w-5" />
        </a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href={ownersLink.href}
          {...goal("owners")}
          className={
            isPrimary
              ? "pressable inline-flex items-center justify-center rounded-full border border-slate-500 px-6 py-3 font-semibold text-white hover:border-slate-300"
              : "pressable inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-900 hover:border-slate-400"
          }
        >
          {ownersLink.label}
        </a>
      </div>
    </section>
  );
}
