import {
  buildBreadcrumbListLd,
  buildFAQPageLd,
  buildSoftwareApplicationLd,
  serializeJsonLd,
  type MonthlyOffer,
} from "../json-ld";

/**
 * s88 — the homepage's SoftwareApplication JSON-LD says only what is true.
 *
 * ADR 032 §5: verified fields only, no invented reviews or ratings, offers only
 * when the live catalogue supports them. Google shows star snippets only for
 * markup with `aggregateRating` or `review`; there are none to show, so the
 * page goes without stars rather than with made-up ones.
 */

const BASE = {
  url: "https://recopyfa.st",
  name: "ReCopyFast",
  description: "Make the copy on the site you already built editable.",
};

const OFFERS: MonthlyOffer[] = [
  {
    name: "Starter",
    price: 9,
    currency: "USD",
    url: "https://recopyfa.st/#pricing",
  },
  {
    name: "Pro",
    price: 19,
    currency: "USD",
    url: "https://recopyfa.st/#pricing",
  },
];

describe("buildSoftwareApplicationLd", () => {
  it("describes the product as a web application", () => {
    const ld = buildSoftwareApplicationLd({ ...BASE, offers: OFFERS });

    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "ReCopyFast",
      description: BASE.description,
      url: "https://recopyfa.st",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
    });
  });

  it("states each offer as a monthly price in its currency", () => {
    const ld = buildSoftwareApplicationLd({ ...BASE, offers: OFFERS });

    expect(ld.offers).toEqual([
      {
        "@type": "Offer",
        name: "Starter",
        price: 9,
        priceCurrency: "USD",
        url: "https://recopyfa.st/#pricing",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: 9,
          priceCurrency: "USD",
          referenceQuantity: {
            "@type": "QuantitativeValue",
            value: 1,
            unitCode: "MON",
          },
        },
      },
      expect.objectContaining({ name: "Pro", price: 19, priceCurrency: "USD" }),
    ]);
  });

  it("omits offers entirely when there are none to state", () => {
    const ld = buildSoftwareApplicationLd({ ...BASE, offers: [] });

    expect(ld).not.toHaveProperty("offers");
  });

  it("claims no rating and no review", () => {
    const text = JSON.stringify(
      buildSoftwareApplicationLd({ ...BASE, offers: OFFERS }),
    );

    expect(text).not.toMatch(/aggregateRating|"review"|ratingValue/);
  });
});

describe("serializeJsonLd", () => {
  it("cannot close the script element it is written into", () => {
    const text = serializeJsonLd({
      name: "</script><script>alert(1)</script>",
    });

    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual({
      name: "</script><script>alert(1)</script>",
    });
  });
});

describe("shared page schemas", () => {
  it("numbers breadcrumb items in rendered order", () => {
    expect(
      buildBreadcrumbListLd([
        { name: "Comparisons", url: "https://recopyfa.st/compare" },
        {
          name: "Contentful",
          url: "https://recopyfa.st/compare/contentful",
        },
      ]),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Comparisons",
          item: "https://recopyfa.st/compare",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Contentful",
          item: "https://recopyfa.st/compare/contentful",
        },
      ],
    });
  });

  it("uses the same FAQ questions and answers as the visible content", () => {
    const faqs = [
      { question: "Where does content live?", answer: "In the source system." },
      {
        question: "Can clients edit?",
        answer: "Yes, with product-specific access.",
      },
    ];

    expect(buildFAQPageLd(faqs)).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: faqs[0].question,
          acceptedAnswer: { "@type": "Answer", text: faqs[0].answer },
        },
        {
          "@type": "Question",
          name: faqs[1].question,
          acceptedAnswer: { "@type": "Answer", text: faqs[1].answer },
        },
      ],
    });
  });
});
