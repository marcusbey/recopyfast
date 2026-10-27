import {
  parseSpotAvailability,
  SPOT_METER_MAX_CELLS,
  spotMeterCells,
} from "../spot-meter";

describe("parseSpotAvailability", () => {
  it("accepts a consistent open count", () => {
    expect(
      parseSpotAvailability({ limit: 50, remaining: 17, soldOut: false }),
    ).toEqual({ limit: 50, remaining: 17, soldOut: false });
  });

  it("accepts the last spot and a sold-out count", () => {
    expect(
      parseSpotAvailability({ limit: 50, remaining: 1, soldOut: false }),
    ).toEqual({ limit: 50, remaining: 1, soldOut: false });
    expect(
      parseSpotAvailability({ limit: 50, remaining: 0, soldOut: true }),
    ).toEqual({ limit: 50, remaining: 0, soldOut: true });
  });

  it("accepts the full count and the cell cap as the limit", () => {
    expect(
      parseSpotAvailability({ limit: 50, remaining: 50, soldOut: false }),
    ).toEqual({ limit: 50, remaining: 50, soldOut: false });
    expect(
      parseSpotAvailability({
        limit: SPOT_METER_MAX_CELLS,
        remaining: 3,
        soldOut: false,
      }),
    ).toEqual({ limit: SPOT_METER_MAX_CELLS, remaining: 3, soldOut: false });
  });

  it("caps the meter at 100 cells", () => {
    expect(SPOT_METER_MAX_CELLS).toBe(100);
    expect(
      parseSpotAvailability({
        limit: SPOT_METER_MAX_CELLS + 1,
        remaining: 3,
        soldOut: false,
      }),
    ).toBeNull();
    expect(
      parseSpotAvailability({ limit: 5000, remaining: 5000, soldOut: false }),
    ).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "50"],
    ["a number", 50],
    ["an array", [50, 17, false]],
    ["an empty object", {}],
  ])("rejects %s", (_label, value) => {
    expect(parseSpotAvailability(value)).toBeNull();
  });

  it.each([
    ["a zero limit", { limit: 0, remaining: 0, soldOut: true }],
    ["a negative limit", { limit: -50, remaining: 0, soldOut: true }],
    ["a fractional limit", { limit: 50.5, remaining: 17, soldOut: false }],
    ["a NaN limit", { limit: Number.NaN, remaining: 17, soldOut: false }],
    [
      "an infinite limit",
      { limit: Number.POSITIVE_INFINITY, remaining: 17, soldOut: false },
    ],
    ["a string limit", { limit: "50", remaining: 17, soldOut: false }],
    ["a negative remaining", { limit: 50, remaining: -1, soldOut: false }],
    ["a fractional remaining", { limit: 50, remaining: 16.5, soldOut: false }],
    ["a NaN remaining", { limit: 50, remaining: Number.NaN, soldOut: false }],
    ["a string remaining", { limit: 50, remaining: "17", soldOut: false }],
    ["remaining above limit", { limit: 50, remaining: 51, soldOut: false }],
    ["a missing soldOut", { limit: 50, remaining: 17 }],
    ["a string soldOut", { limit: 50, remaining: 17, soldOut: "false" }],
    ["soldOut with spots left", { limit: 50, remaining: 17, soldOut: true }],
    ["open at zero", { limit: 50, remaining: 0, soldOut: false }],
  ])("rejects %s", (_label, value) => {
    expect(parseSpotAvailability(value)).toBeNull();
  });

  it("reads only own fields, never the prototype chain", () => {
    const inherited = Object.create({
      limit: 50,
      remaining: 17,
      soldOut: false,
    }) as unknown;
    expect(parseSpotAvailability(inherited)).toBeNull();

    const polluted = JSON.parse(
      '{"__proto__": {"limit": 50, "remaining": 17, "soldOut": false}}',
    ) as unknown;
    expect(parseSpotAvailability(polluted)).toBeNull();
  });

  it("returns a fresh object without extra fields", () => {
    const input = { limit: 50, remaining: 17, soldOut: false, extra: "x" };
    const parsed = parseSpotAvailability(input);
    expect(parsed).toEqual({ limit: 50, remaining: 17, soldOut: false });
    expect(parsed).not.toBe(input);
  });
});

describe("spotMeterCells", () => {
  it("draws one cell per spot: taken, then the next, then the rest", () => {
    expect(spotMeterCells(5, 3)).toEqual([
      "taken",
      "taken",
      "next",
      "left",
      "left",
    ]);
  });

  it("marks the first cell next when nothing is taken", () => {
    const cells = spotMeterCells(50, 50);
    expect(cells).toHaveLength(50);
    expect(cells[0]).toBe("next");
    expect(cells.slice(1).every((cell) => cell === "left")).toBe(true);
  });

  it("marks only the last cell next when one spot is left", () => {
    const cells = spotMeterCells(50, 1);
    expect(cells).toHaveLength(50);
    expect(cells.slice(0, 49).every((cell) => cell === "taken")).toBe(true);
    expect(cells[49]).toBe("next");
  });

  it("draws every cell taken when sold out", () => {
    const cells = spotMeterCells(50, 0);
    expect(cells).toHaveLength(50);
    expect(cells.every((cell) => cell === "taken")).toBe(true);
  });

  it("draws a single-spot meter", () => {
    expect(spotMeterCells(1, 1)).toEqual(["next"]);
    expect(spotMeterCells(1, 0)).toEqual(["taken"]);
  });
});
