/**
 * @jest-environment node
 */

import { analyzeOutdatedBlock } from "../rules";

const PAGE = "https://example.com/";

function run(text: string, iso = "2026-10-11T12:00:00Z") {
  return analyzeOutdatedBlock(text, PAGE, new Date(iso));
}

function kinds(text: string, iso?: string): string[] {
  return run(text, iso).map(({ finding }) => finding.kind);
}

describe("copyright years", () => {
  it.each(["© 2025 Acme", "Copyright 2024 Acme", "Acme (c) 2023"])(
    "flags %s after January",
    (text) => {
      expect(run(text)).toEqual([
        expect.objectContaining({
          level: "stale",
          finding: expect.objectContaining({ kind: "copyright-year" }),
        }),
      ]);
    },
  );

  it("uses the range's final year", () => {
    expect(kinds("Copyright 2024/25 Acme")).toEqual(["copyright-year"]);
    expect(kinds("Copyright 2025/26 Acme")).toEqual([]);
  });

  it("gives the January grace through January 31, then becomes stale", () => {
    expect(run("© 2025 Acme", "2026-01-31T23:59:59Z")[0]).toMatchObject({
      level: "info",
      finding: { kind: "copyright-year-grace" },
    });
    expect(run("© 2025 Acme", "2026-02-01T00:00:00Z")[0]).toMatchObject({
      level: "stale",
      finding: { kind: "copyright-year" },
    });
  });

  it("ignores a current or future year and a bare old year", () => {
    expect(kinds("© 2026 Acme · next year 2027")).toEqual([]);
    expect(kinds("Founded in 2015")).toEqual([]);
  });
});

describe("past dates still presented as future", () => {
  it.each([
    "Register for October 3, 2025",
    "October 3, 2025 — join us",
    "Book now: 2025-10-03",
    "Tickets available until October 2025",
    "Save the date — 3–5 October 2025",
  ])("flags %s", (text) => {
    expect(kinds(text)).toContain("past-date-upcoming");
  });

  it("honours the 60-character boundary", () => {
    expect(kinds(`October 3, 2025${" ".repeat(60)}register`)).toContain(
      "past-date-upcoming",
    );
    expect(kinds(`October 3, 2025${" ".repeat(61)}register`)).not.toContain(
      "past-date-upcoming",
    );
  });

  it("never borrows future wording from another extracted block", () => {
    expect([
      ...run("October 3, 2025"),
      ...run("Register for our annual event"),
    ]).toEqual([]);
  });

  it.each([
    "Published October 3, 2025",
    "Posted on October 3, 2025",
    "Since October 3, 2025",
    "Founded October 3, 2025",
    "Established October 3, 2025",
    "Last updated: October 3, 2025",
    "Our next chapter began October 3, 2025",
    "Read our October 3, 2025 book",
    "Register for October 11, 2026",
    "Register for 03/04/2025",
  ])("leaves %s alone", (text) => {
    expect(kinds(text)).not.toContain("past-date-upcoming");
  });
});

describe("year-stamped prices and future-tense launches", () => {
  it.each([
    "2025 prices",
    "Rates for 2024/25",
    "Our 2025 menu",
    "2025/25 schedule",
    "Catalogue 2024",
  ])("flags %s", (text) => {
    expect(kinds(text)).toContain("dated-prices");
  });

  it.each(["2026 prices", "2026/27 rates", "Schedule for 2027"])(
    "keeps %s",
    (text) => {
      expect(kinds(text)).not.toContain("dated-prices");
    },
  );

  it.each([
    "Coming soon in 2025",
    "Launching in 2024",
    "Opening for 2025",
    "Arriving in 2025",
    "New in 2025",
  ])("flags %s", (text) => {
    expect(kinds(text)).toContain("past-future-tense");
  });

  it.each(["Coming in 2026", "Launching in 2027"])("keeps %s", (text) => {
    expect(kinds(text)).not.toContain("past-future-tense");
  });
});

describe("seasonal promotions", () => {
  it.each([
    "Black Friday 2025 sale",
    "Cyber Monday offer 2024",
    "Christmas 2025 offer",
    "Valentine's sale 2025",
    "Halloween 2024 offer",
  ])("flags the past year in %s", (text) => {
    expect(run(text)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "stale",
          finding: expect.objectContaining({
            kind: "seasonal-promo-past-year",
          }),
        }),
      ]),
    );
  });

  it("warns only when an undated sale is outside its pinned UTC window", () => {
    expect(run("Summer sale", "2026-10-11T12:00:00Z")[0]).toMatchObject({
      level: "warn",
      finding: { kind: "seasonal-promo-out-of-season" },
    });
    expect(kinds("Summer sale", "2026-07-15T12:00:00Z")).toEqual([]);
    expect(kinds("Our summer opening hours", "2026-10-11T12:00:00Z")).toEqual(
      [],
    );
  });

  it.each(["2035", "1989"])(
    "does not call a promotion undated when the explicit out-of-range year is %s",
    (year) => {
      expect(kinds(`Summer ${year} sale`, "2026-10-11T12:00:00Z")).toEqual([]);
    },
  );

  it.each([
    "Summer sale, call extension 5555",
    "Summer sale at 5555 King Street",
  ])("does not mistake an unrelated number for a year in %s", (text) => {
    expect(kinds(text, "2026-10-11T12:00:00Z")).toEqual([
      "seasonal-promo-out-of-season",
    ]);
  });

  it("uses the same inclusive 60-character boundary for plausible year presence", () => {
    const withYearAt = (distance: number) =>
      `Summer sale${" ".repeat(distance - " sale".length)}2035`;

    expect(kinds(withYearAt(60), "2026-10-11T12:00:00Z")).toEqual([]);
    expect(kinds(withYearAt(61), "2026-10-11T12:00:00Z")).toEqual([
      "seasonal-promo-out-of-season",
    ]);
  });

  it("keeps an accepted future year when the reference clock crosses a century", () => {
    expect(kinds("Summer 2100 sale", "2098-10-11T12:00:00Z")).toEqual([]);
  });

  it("handles wrap-around holiday and New Year windows", () => {
    expect(kinds("Holiday offer", "2026-12-20T12:00:00Z")).toEqual([]);
    expect(kinds("Holiday offer", "2027-01-06T12:00:00Z")).toEqual([]);
    expect(kinds("Holiday offer", "2027-01-07T12:00:00Z")).toEqual([
      "seasonal-promo-out-of-season",
    ]);
    expect(kinds("New Year sale", "2027-01-15T12:00:00Z")).toEqual([]);
    expect(kinds("New Year sale", "2027-01-16T12:00:00Z")).toEqual([
      "seasonal-promo-out-of-season",
    ]);
  });
});

describe("old update labels", () => {
  it("reports an update more than two calendar years old as information", () => {
    expect(run("Last updated: October 10, 2024")[0]).toMatchObject({
      level: "info",
      finding: { kind: "stale-updated" },
    });
  });

  it.each([
    "Last updated: October 11, 2024",
    "Updated: October 2024",
    "Published October 10, 2024",
    "October 10, 2024",
  ])("leaves %s alone", (text) => {
    expect(kinds(text)).not.toContain("stale-updated");
  });
});
