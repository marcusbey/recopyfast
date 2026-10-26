/**
 * Shared JSON-LD builders (ADR 012 §3). Plain inputs, no page- or
 * cluster-specific types, so every page states structured data the same way.
 *
 * s88 added SoftwareApplication and safe serialization. s17 moved FAQPage and
 * BreadcrumbList here after the first comparison implementation built and
 * escaped them separately; one builder and one serializer keep visible copy
 * and machine-readable copy on the same contract (ADR 032 §5).
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

type WebApplicationInput = {
  url: string;
  name: string;
  description: string;
};

type BreadcrumbItem = {
  readonly name: string;
  readonly url: string;
};

type FAQItem = {
  readonly question: string;
  readonly answer: string;
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
 * schema.org `WebApplication` for a free in-browser tool (s96 decision 12,
 * first used by s98).
 *
 * The one price is the truth: the tool is free, so `offers` is a $0 `Offer`
 * and `isAccessibleForFree` is true. As with `SoftwareApplication`, ADR 032 §5
 * applies: no `aggregateRating` and no `review`, so no star snippet.
 */
export function buildWebApplicationLd(input: WebApplicationInput) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: input.name,
    description: input.description,
    url: input.url,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Web",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
  };
}

type ArticleInput = {
  readonly headline: string;
  readonly description: string;
  readonly url: string;
  /** ISO date (YYYY-MM-DD) the content was last reviewed. */
  readonly dateModified: string;
  /** Absolute URL of the page's social image. */
  readonly image: string;
  /** The organisation that writes and publishes the article. */
  readonly publisherName: string;
  readonly publisherUrl: string;
};

/**
 * schema.org `Article` for an editorial guide (s123). The author and the
 * publisher are the organisation: no guide has a named person behind it, and
 * a byline invented for structured data would be a false claim. Only
 * `dateModified` is stated, because a guide records when its facts were last
 * checked against its sources, not when it was first drafted.
 */
export function buildArticleLd(input: ArticleInput) {
  const organization = {
    "@type": "Organization",
    name: input.publisherName,
    url: input.publisherUrl,
  };
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    url: input.url,
    mainEntityOfPage: { "@type": "WebPage", "@id": input.url },
    image: [input.image],
    // A bare date trips Google's Rich Results Test ("invalid datetime",
    // "missing a timezone"); state the review date as midnight UTC.
    dateModified: `${input.dateModified}T00:00:00Z`,
    author: organization,
    publisher: organization,
  };
}

export function buildBreadcrumbListLd(items: readonly BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function buildFAQPageLd(items: readonly FAQItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
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
