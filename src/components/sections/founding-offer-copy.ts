import type { FoundingOfferView } from "@/hooks/useFoundingOffer";

/**
 * The founding-offer strings more than one landing section says (s47b).
 *
 * `limit` is always the count's own `limit`, never a literal 20: the database
 * owns the number of spots (s47a), and a hardcoded copy here is a second source
 * free to drift from it. Kept under `src/components` so s50's retired-promises
 * scan reads it.
 */

export function foundingOfferHeadline(limit: number): string {
  return `First ${limit} users get ReCopyFast Pro free for 3 months`;
}

/**
 * The first item of both trust rows (Pricing and FinalCTA). Loading says only
 * what is true in every state, so the row never shows one promise and then
 * swaps it for the other.
 */
export function foundingOfferTrustLead(offer: FoundingOfferView): string {
  switch (offer.status) {
    case "loading":
      return "Free trial";
    case "open":
      return `3 months free for the first ${offer.limit}`;
    case "closed":
      return "14-day free trial";
  }
}
