/**
 * @jest-environment node
 */

import { findRecognizedDates, isPastDate, parseYearReference } from "../dates";

const NOW = new Date("2026-10-11T12:00:00Z");

describe("outdated-copy dates", () => {
  it.each([
    ["October 3rd, 2025", "2025-10-03T23:59:59.999Z", "day"],
    ["3 October 2025", "2025-10-03T23:59:59.999Z", "day"],
    ["Oct. 3, 2025", "2025-10-03T23:59:59.999Z", "day"],
    ["October 2025", "2025-10-31T23:59:59.999Z", "month"],
    ["2025-10-03", "2025-10-03T23:59:59.999Z", "day"],
    ["Oct 3–5, 2025", "2025-10-05T23:59:59.999Z", "day"],
    ["3–5 October 2025", "2025-10-05T23:59:59.999Z", "day"],
  ] as const)("recognizes %s", (text, end, precision) => {
    expect(findRecognizedDates(`Offer: ${text}.`, NOW)).toEqual([
      expect.objectContaining({
        text,
        endDate: new Date(end),
        precision,
      }),
    ]);
  });

  it("uses the end of a day or month, so today and the current month are not past", () => {
    const [today] = findRecognizedDates("October 11, 2026", NOW);
    const [month] = findRecognizedDates("October 2026", NOW);

    expect(isPastDate(today, NOW)).toBe(false);
    expect(isPastDate(month, NOW)).toBe(false);
    expect(isPastDate(month, new Date("2026-11-01T00:00:00Z"))).toBe(true);
  });

  it("uses the range end, including an abbreviated final year", () => {
    expect(parseYearReference("2026/27", NOW)).toEqual({
      startYear: 2026,
      finalYear: 2027,
    });
    expect(parseYearReference("2024–2026", NOW)).toEqual({
      startYear: 2024,
      finalYear: 2026,
    });
  });

  it("round-trips calendar components and handles leap years", () => {
    expect(findRecognizedDates("February 29, 2024", NOW)).toHaveLength(1);
    expect(findRecognizedDates("February 29, 2025", NOW)).toEqual([]);
    expect(findRecognizedDates("February 30, 2024", NOW)).toEqual([]);
    expect(findRecognizedDates("2025-13-01", NOW)).toEqual([]);
    expect(findRecognizedDates("31 April 2025", NOW)).toEqual([]);
  });

  it("ignores numeric slash dates and years outside the accepted window", () => {
    expect(findRecognizedDates("03/04/2025", NOW)).toEqual([]);
    expect(findRecognizedDates("January 1, 1989", NOW)).toEqual([]);
    expect(findRecognizedDates("January 1, 2032", NOW)).toEqual([]);
    expect(parseYearReference("1989", NOW)).toBeNull();
    expect(parseYearReference("2032", NOW)).toBeNull();
  });

  it("keeps a large hostile-looking input comfortably linear", () => {
    const text = `${"October ".repeat(20_000)}October 3, 2025`;
    const started = performance.now();

    expect(findRecognizedDates(text, NOW)).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
