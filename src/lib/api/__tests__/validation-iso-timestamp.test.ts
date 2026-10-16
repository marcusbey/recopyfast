/**
 * s81 — a row-version token crosses PostgREST, JSON and the staging PUT.
 * Validation may inspect it, but must never rebuild it through Date because
 * Date.toISOString() drops PostgreSQL's microseconds. Only omission preserves
 * the legacy last-write-wins path; explicit null and malformed values refuse.
 */

import { optionalIsoTimestamp } from "@/lib/api/validation";

describe("optionalIsoTimestamp", () => {
  it("preserves a valid PostgreSQL timestamp string exactly", () => {
    const timestamp = "2026-10-08T10:00:00.987654+00:00";

    expect(
      optionalIsoTimestamp(
        { expectedUpdatedAt: timestamp },
        "expectedUpdatedAt",
      ),
    ).toEqual({
      ok: true,
      value: timestamp,
    });
  });

  it("treats omission, and only omission, as the unconditional path", () => {
    expect(optionalIsoTimestamp({}, "expectedUpdatedAt")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      optionalIsoTimestamp({ expectedUpdatedAt: null }, "expectedUpdatedAt"),
    ).toEqual({
      ok: false,
      error: 'Field "expectedUpdatedAt" must be a valid ISO timestamp',
    });
  });

  it.each([
    123,
    "yesterday",
    "2026-02-30T10:00:00+00:00",
    "2026-10-08T25:00:00+00:00",
    "2026-10-08T10:00:00.1234567+00:00",
    "2".repeat(65),
  ])("refuses %p", (value) => {
    expect(
      optionalIsoTimestamp({ expectedUpdatedAt: value }, "expectedUpdatedAt"),
    ).toEqual({
      ok: false,
      error: 'Field "expectedUpdatedAt" must be a valid ISO timestamp',
    });
  });
});
