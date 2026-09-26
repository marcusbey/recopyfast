import { formatDate } from "../format-date";

/*
 * These instants are chosen so a formatter that silently follows the process
 * time zone fails in any zone but UTC itself: `2024-01-15` is UTC midnight, the
 * previous day anywhere west of Greenwich, and 23:30Z is the next day anywhere
 * at UTC+0:30 or further east. Run under `TZ=Pacific/Kiritimati` (UTC+14) as
 * well as `TZ=UTC` — Jest cannot change the process zone from inside a test.
 */
describe("formatDate", () => {
  it("prints a date-only ISO string as that calendar day", () => {
    expect(formatDate("2024-01-15")).toBe("Jan 15, 2024");
  });

  it("prints a late-UTC instant as its UTC day, not the next local one", () => {
    expect(formatDate("2024-01-15T23:30:00Z")).toBe("Jan 15, 2024");
  });

  it("prints an offset timestamp as the UTC day it falls on", () => {
    // 10:30 on the 15th at UTC+14 is 20:30 on the 14th in UTC.
    expect(formatDate("2024-01-15T10:30:00+14:00")).toBe("Jan 14, 2024");
  });

  it("accepts a Date", () => {
    expect(formatDate(new Date(Date.UTC(2024, 0, 15, 12)))).toBe(
      "Jan 15, 2024",
    );
  });

  it("returns an empty string instead of throwing for an unparseable value", () => {
    expect(() => formatDate("not a date")).not.toThrow();
    expect(formatDate("not a date")).toBe("");
  });
});

/*
 * s43 review M1: CI runs in UTC, where a formatter that forgot `timeZone` is
 * indistinguishable from a correct one — every case above stayed green with the
 * pin deleted, and a runtime `process.env.TZ` switch does not reach Intl inside
 * a Jest worker. So assert the construction itself: load a fresh copy of the
 * module and check the formatter it builds is pinned to UTC.
 */
describe("formatDate time zone pin", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds its formatter pinned to UTC, whatever zone the process runs in", () => {
    const construct = jest.spyOn(Intl, "DateTimeFormat");

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../format-date");
    });

    expect(construct).toHaveBeenCalledWith(
      "en-US",
      expect.objectContaining({ timeZone: "UTC" }),
    );
  });
});
