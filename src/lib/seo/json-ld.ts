/**
 * Shared JSON-LD builders (ADR 012 §3). Plain inputs, no page- or
 * cluster-specific types, so every page states structured data the same way.
 *
 * s88 adds the first two. The comparison pages still build their FAQPage and
 * BreadcrumbList inline (`components/compare/ComparisonPage.tsx`); moving them
 * here is s17's work, as is SoftwareApplication on those pages (ADR 032 §5).
 */

/** One recurring price, stated per month. `currency` is ISO 4217. */
export type MonthlyOffer = {
  name: string;
  price: number;
  currency: string;
  url: string;
};

type SoftwareApplicationInput = {
  url: string;
  name: string;
  description: string;
  offers: readonly MonthlyOffer[];
};

/**
 * schema.org `SoftwareApplication`.
 *
 * ADR 032 §5 sets the rules: verified fields only, no invented reviews or
 * ratings, offers only when the live catalogue supports them. So there is no
 * `aggregateRating` and no `review` — and therefore no star snippet, because
 * Google requires one of the two for that. And when there is no offer to
 * state, the key is omitted rather than filled with a guessed price.
 *
 * `operatingSystem: "Web"`: it runs in the browser, on the customer's own site.
 */
export function buildSoftwareApplicationLd(input: SoftwareApplicationInput) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: input.name,
    description: input.description,
    url: input.url,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    ...(input.offers.length > 0
      ? { offers: input.offers.map(toMonthlyOfferLd) }
      : {}),
  };
}

/**
 * The price, plus a `UnitPriceSpecification` saying what it buys: one month
 * (UN/CEFACT `MON`). Without it a subscription price reads as a one-off sale.
 */
function toMonthlyOfferLd(offer: MonthlyOffer) {
  return {
    "@type": "Offer",
    name: offer.name,
    price: offer.price,
    priceCurrency: offer.currency,
    url: offer.url,
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: offer.price,
      priceCurrency: offer.currency,
      referenceQuantity: {
        "@type": "QuantitativeValue",
        value: 1,
        unitCode: "MON",
      },
    },
  };
}

/**
 * JSON for a `<script type="application/ld+json">` body. `<` is escaped so no
 * string in the data — a plan name from the database, say — can close the
 * element and start markup of its own. Same escape as the comparison pages.
 */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
