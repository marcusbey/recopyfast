import { Check, Rocket } from "lucide-react";
import Link from "next/link";
import { foundingOfferHeadline } from "./founding-offer-copy";

/**
 * The founding offer in the pricing section (s47b): the first `limit` accounts
 * get Pro free for 90 days, 100 AI credits a month, no card (s47a).
 *
 * The 90 days, the 100 credits and the 14-day fallback are the grant's own
 * terms, restated here because the modules that hold them reach the
 * service-role client and may not be bundled into the landing page.
 * `Pricing.founding-offer.test.tsx` ties each one back to its source.
 *
 * Flat `bg-white` with no gradient and no shadow, on purpose: the Founding
 * Agency card beside it carries both, and both break the design system.
 */

const BENEFITS = [
  "5 websites",
  "Invited editors",
  "All sites view",
  "AI suggestions",
  "100 AI credits a month",
  "No credit card required",
];

interface FoundingOfferCardProps {
  remaining: number;
  limit: number;
  /** From the pricing payload's `credits` product; null drops the sentence. */
  creditPack: { credits: number; price: number } | null;
}

export default function FoundingOfferCard({
  remaining,
  limit,
  creditPack,
}: FoundingOfferCardProps) {
  const count =
    remaining === 1
      ? `Last spot left — 1 of ${limit}`
      : `${remaining} of ${limit} spots left`;

  return (
    <div className="mb-8 rounded-3xl border-2 border-teal-500 bg-white p-8 text-left">
      <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
        <div>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50">
            <Rocket className="h-6 w-6 text-teal-700" />
          </div>
          <span className="mb-3 inline-block rounded-full bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white">
            Founding offer
          </span>
          <h3 className="mb-2 text-2xl font-semibold text-slate-900">
            {foundingOfferHeadline(limit)}
          </h3>
          <p className="text-sm text-slate-600">
            Every Pro feature for 90 days, with 100 AI credits a month. No
            credit card, and nothing is charged when it ends.
          </p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
                <span className="text-sm text-slate-700">{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-56 text-center md:text-right">
          <div className="flex items-baseline justify-center gap-1 md:justify-end">
            <span className="text-5xl font-bold text-slate-900">$0</span>
            <span className="text-slate-600">for 3 months</span>
          </div>
          <p className="tabular mt-1 text-sm font-medium text-teal-800">
            {count}
          </p>
          <Link
            href="/signup"
            className="pressable mt-5 block rounded-xl bg-teal-700 px-6 py-3 text-center font-semibold text-white hover:bg-teal-800"
          >
            Claim your spot
          </Link>
        </div>
      </div>

      {/* The count can lag a sign-up by a few seconds; the second paragraph is
          what keeps "Claim your spot" honest at that boundary. */}
      <div className="mt-8 space-y-2 border-t border-sky-100 pt-6 text-sm text-slate-600">
        <p>
          After 90 days, choose a plan to keep editing. Your site keeps serving
          its content either way.
          {creditPack &&
            ` Need more AI before then? ${creditPack.credits.toLocaleString("en-US")} credits for $${creditPack.price}.`}
        </p>
        <p>
          Spots go in sign-up order. If all {limit} are taken when you sign up,
          you get the 14-day Pro trial instead.
        </p>
      </div>
    </div>
  );
}
