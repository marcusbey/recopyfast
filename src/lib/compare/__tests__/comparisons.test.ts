import {
  comparisonList,
  getComparisonFromRegistry,
  validateComparisonRegistry,
  type Comparison,
} from "../comparisons";

const REQUIRED_ROWS = [
  "Best at",
  "Installation",
  "Editor access",
  "Publishing",
  "How published edits reach visitors",
  "Pricing model",
] as const;

function fixture(overrides: Partial<Comparison> = {}): Comparison {
  return {
    slug: "fixture",
    competitor: "Fixture CMS",
    officialHost: "example.com",
    factsCheckedAsOf: "2026-10",
    title: "ReCopyFast vs Fixture CMS",
    description: "A complete and distinct Fixture CMS comparison.",
    hubDescription: "A short hub description for Fixture CMS.",
    shortAnswer:
      "Choose Fixture CMS for structured publishing; choose ReCopyFast for focused edits on an existing site.",
    competitorFit: [
      "Structured content is the source of truth.",
      "Editors need a full publishing workspace.",
      "The frontend is already integrated with Fixture CMS.",
    ],
    recopyfastFit: [
      "The existing frontend should stay in place.",
      "Editors only need bounded copy changes.",
      "A product account should not be required for invited clients.",
    ],
    rows: REQUIRED_ROWS.map((label) => ({
      label,
      competitor: `${label} in Fixture CMS.`,
      recopyfast:
        label === "Pricing model"
          ? ({ kind: "live-pricing" } as const)
          : `${label} in ReCopyFast.`,
    })),
    integrationNote:
      "Fixture CMS requires a content integration; ReCopyFast adds a script to an existing site.",
    faqs: [
      { question: "What is Fixture CMS?", answer: "A fixture for tests." },
      { question: "Where does content live?", answer: "In its content store." },
      { question: "Does it publish?", answer: "Yes, through its workflow." },
      {
        question: "When should I use ReCopyFast?",
        answer: "For bounded edits.",
      },
    ],
    sources: [
      {
        label: "Fixture CMS documentation",
        href: "https://docs.example.com/fixture",
      },
    ],
    ...overrides,
  };
}

describe("comparison registry validation", () => {
  it("ships the exact seven approved comparison slugs", () => {
    expect(comparisonList.map((comparison) => comparison.slug)).toEqual([
      "webflow-editor",
      "duda",
      "tinacms",
      "cloudcannon",
      "contentful",
      "storyblok",
      "decap-cms",
    ]);
  });

  it("accepts and resolves a complete data-only extension", () => {
    const registry = { fixture: fixture() };

    expect(() => validateComparisonRegistry(registry)).not.toThrow();
    expect(getComparisonFromRegistry(registry, "fixture")?.competitor).toBe(
      "Fixture CMS",
    );
    expect(getComparisonFromRegistry(registry, "missing")).toBeNull();
  });

  it("rejects a slug that does not agree with its registry key", () => {
    expect(() =>
      validateComparisonRegistry({ fixture: fixture({ slug: "other" }) }),
    ).toThrow(/slug.*registry key/i);
  });

  it("rejects duplicate metadata and incomplete fit statements", () => {
    expect(() =>
      validateComparisonRegistry({
        first: fixture({ slug: "first" }),
        second: fixture({
          slug: "second",
          competitor: "Second CMS",
          recopyfastFit: ["Only one statement."],
        }),
      }),
    ).toThrow(/at least 3/i);

    expect(() =>
      validateComparisonRegistry({
        first: fixture({ slug: "first" }),
        second: fixture({ slug: "second", competitor: "Second CMS" }),
      }),
    ).toThrow(/metadata.*unique/i);
  });

  it("rejects missing required rows and duplicate FAQ questions", () => {
    expect(() =>
      validateComparisonRegistry({
        fixture: fixture({ rows: fixture().rows.slice(1) }),
      }),
    ).toThrow(/required.*row/i);

    const faq = fixture().faqs;
    expect(() =>
      validateComparisonRegistry({
        fixture: fixture({ faqs: [...faq.slice(0, 3), faq[0]] }),
      }),
    ).toThrow(/4 unique faq/i);
  });

  it("requires live catalogue pricing only in the pricing row", () => {
    const withTextPricing = fixture().rows.map((row) =>
      row.label === "Pricing model"
        ? { ...row, recopyfast: "A stale hard-coded price." }
        : row,
    );
    expect(() =>
      validateComparisonRegistry({
        fixture: fixture({ rows: withTextPricing }),
      }),
    ).toThrow(/Pricing model.*live-pricing/i);

    const withMarkerOutsidePricing = fixture().rows.map((row) =>
      row.label === "Best at"
        ? { ...row, recopyfast: { kind: "live-pricing" } as const }
        : row,
    );
    expect(() =>
      validateComparisonRegistry({
        fixture: fixture({ rows: withMarkerOutsidePricing }),
      }),
    ).toThrow(/Best at.*nonempty text/i);
  });

  it("rejects non-HTTPS, credentialed, and off-domain sources", () => {
    for (const href of [
      "http://docs.example.com/fixture",
      "https://user:secret@docs.example.com/fixture",
      "https://example.net/fixture",
    ]) {
      expect(() =>
        validateComparisonRegistry({
          fixture: fixture({
            sources: [{ label: "Unsafe source", href }],
          }),
        }),
      ).toThrow(/official https/i);
    }
  });
});
