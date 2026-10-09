import {
  ALTERNATIVES,
  ALTERNATIVE_SLUGS,
  getComparisonEntry,
  validateComparisonEntry,
  validateComparisonEntries,
  type ComparisonEntry,
} from "../alternatives";

const VALID_ENTRY: ComparisonEntry = {
  slug: "tinacms",
  name: "TinaCMS",
  metaTitle: "TinaCMS alternative for existing sites | RecopyFast",
  metaDescription:
    "Compare TinaCMS with RecopyFast for editing an existing client website.",
  intro:
    "Both products support visual editing, but they begin from different content models.",
  setup: "Add a typed content model and integrate the editor with the site.",
  whereContentLives: "File-based content stored with the site in Git.",
  editingWithoutDev: "Yes, after a developer completes the integration.",
  clientEditsWithoutAccount: "No. Editors are users on the project.",
  startingPrice: {
    label: "$0 Free; Team from $29/month",
    checkedAt: "2026-09-12",
    sourceUrl: "https://tina.io/pricing",
  },
  whereTheyWin: [
    "Git-native content history",
    "A typed content model",
    "Editorial workflow options",
  ],
  whereWeWin: [
    "Works on an existing rendered site",
    "No content-model migration before the first edit",
    "A bounded client editing surface",
  ],
  faq: [
    {
      question: "Is either option free?",
      answer: "Both offer a free starting point.",
    },
    {
      question: "Where is content stored?",
      answer: "The products use different storage models.",
    },
    {
      question: "Can clients edit visually?",
      answer: "Both can support visual editing.",
    },
    {
      question: "Does setup require development?",
      answer: "The setup paths differ materially.",
    },
  ],
  migrationSteps: [
    "Choose one existing page",
    "Install and verify the RecopyFast script",
    "Invite a client after confirming the editable elements",
  ],
  sources: [
    {
      label: "TinaCMS pricing",
      url: "https://tina.io/pricing",
      checkedAt: "2026-09-12",
    },
  ],
};

describe("alternative comparison content validation", () => {
  it("accepts an entry with at least three honest strengths on each side", () => {
    expect(() => validateComparisonEntry(VALID_ENTRY)).not.toThrow();
  });

  it("rejects an entry with fewer than three competitor strengths", () => {
    expect(() =>
      validateComparisonEntry({
        ...VALID_ENTRY,
        whereTheyWin: VALID_ENTRY.whereTheyWin.slice(0, 2),
      }),
    ).toThrow("whereTheyWin must contain at least 3 items");
  });

  it("rejects an entry whose FAQ cannot support the rendered schema", () => {
    expect(() =>
      validateComparisonEntry({
        ...VALID_ENTRY,
        faq: VALID_ENTRY.faq.slice(0, 3),
      }),
    ).toThrow("faq must contain between 4 and 5 items");
  });

  it("rejects undated or non-HTTPS claim sources", () => {
    expect(() =>
      validateComparisonEntry({
        ...VALID_ENTRY,
        sources: [
          { label: "Unknown source", url: "http://example.com", checkedAt: "" },
        ],
      }),
    ).toThrow("sources must use dated HTTPS URLs");
  });

  it("requires exactly one valid entry for every closed competitor slug", () => {
    expect(() => validateComparisonEntries([VALID_ENTRY])).toThrow(
      "comparison entries must cover every alternative slug exactly once",
    );
  });

  it("ships one validated entry for every supported competitor", () => {
    expect(ALTERNATIVES.map((entry) => entry.slug)).toEqual(ALTERNATIVE_SLUGS);
    expect(() => validateComparisonEntries(ALTERNATIVES)).not.toThrow();
    expect(getComparisonEntry("cloudcannon")?.name).toBe("CloudCannon");
    expect(getComparisonEntry("unknown")).toBeNull();
  });

  it("does not reuse win claims across competitor pages", () => {
    const claims = ALTERNATIVES.flatMap((entry) => [
      ...entry.whereTheyWin,
      ...entry.whereWeWin,
    ]);

    expect(new Set(claims).size).toBe(claims.length);
  });

  it("dates every external fact source used by the comparison copy", () => {
    for (const entry of ALTERNATIVES) {
      expect(entry.sources.length).toBeGreaterThanOrEqual(2);
      expect(
        entry.sources.every((source) => source.checkedAt === "2026-09-12"),
      ).toBe(true);
    }
  });
});
