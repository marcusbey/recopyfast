import {
  CURRENCIES,
  DEFAULT_INPUTS,
  INPUT_LIMITS,
  calculateCost,
  clampInputs,
  describeFieldIssue,
  describeFieldRounding,
} from "../calculate";

describe("calculateCost, defaults", () => {
  it("states the pinned result and the formula sentence for the defaults", () => {
    const result = calculateCost(DEFAULT_INPUTS);

    expect(result.changesMonthly).toBe(20);
    expect(result.hoursMonthly).toBeCloseTo(6.6667, 4);
    expect(result.unbilledMonthly).toBeCloseTo(400, 6);
    expect(result.unbilledYearly).toBeCloseTo(4800, 6);
    expect(result.formatted).toEqual({
      hoursMonthly: "6.7",
      unbilledHoursMonthly: "6.7",
      unbilledMonthly: "$400",
      unbilledYearly: "$4,800",
      hourlyRate: "$60",
    });
    expect(result.formula).toBe(
      "10 sites × 2 changes a month × 20 minutes = 6.7 hours a month. At $60 an hour with 0% billed, that's $400 a month and $4,800 a year.",
    );
  });

  it("uses singular nouns for one of each", () => {
    const result = calculateCost({
      ...DEFAULT_INPUTS,
      sites: 1,
      changesPerSiteMonthly: 1,
      minutesPerChange: 1,
    });

    expect(result.formula).toMatch(
      /^1 site × 1 change a month × 1 minute = 0\.0 hours a month\./,
    );
  });
});

describe("calculateCost, billing share", () => {
  it("is zero when every change is billed", () => {
    const result = calculateCost({ ...DEFAULT_INPUTS, billedPercent: 100 });

    expect(result.unbilledHoursMonthly).toBe(0);
    expect(result.unbilledMonthly).toBe(0);
    expect(result.unbilledYearly).toBe(0);
    expect(result.formatted.unbilledYearly).toBe("$0");
    expect(result.hoursMonthly).toBeCloseTo(6.6667, 4);
  });

  it("charges the full amount when nothing is billed", () => {
    const result = calculateCost({ ...DEFAULT_INPUTS, billedPercent: 0 });

    expect(result.unbilledMonthly).toBeCloseTo(400, 6);
  });

  it("halves the cost at 50% billed", () => {
    const result = calculateCost({ ...DEFAULT_INPUTS, billedPercent: 50 });

    expect(result.unbilledYearly).toBeCloseTo(2400, 6);
  });
});

describe("calculateCost, edge cases", () => {
  it("returns zero with no division when there are no changes", () => {
    const result = calculateCost({
      ...DEFAULT_INPUTS,
      changesPerSiteMonthly: 0,
    });

    expect(result.changesMonthly).toBe(0);
    expect(result.hoursMonthly).toBe(0);
    expect(result.unbilledYearly).toBe(0);
    expect(result.formatted.unbilledYearly).toBe("$0");
    expect(Number.isNaN(result.unbilledYearly)).toBe(false);
  });

  it("returns zero cost at a zero hourly rate", () => {
    const result = calculateCost({ ...DEFAULT_INPUTS, hourlyRate: 0 });

    expect(result.unbilledYearly).toBe(0);
    expect(result.hoursMonthly).toBeCloseTo(6.6667, 4);
  });

  it("stays finite and formatted at the largest allowed inputs", () => {
    const result = calculateCost({
      sites: 500,
      changesPerSiteMonthly: 50,
      minutesPerChange: 240,
      hourlyRate: 10_000,
      billedPercent: 0,
      currency: "USD",
    });

    expect(result.hoursMonthly).toBe(100_000);
    expect(result.unbilledMonthly).toBe(1_000_000_000);
    expect(result.unbilledYearly).toBe(12_000_000_000);
    expect(Number.isFinite(result.unbilledYearly)).toBe(true);
    expect(result.formatted.unbilledYearly).toBe("$12,000,000,000");
    expect(result.formatted.hoursMonthly).toBe("100,000.0");
  });

  it("keeps decimals in hours and rounds money to whole units", () => {
    const result = calculateCost({
      ...DEFAULT_INPUTS,
      hourlyRate: 61,
    });

    expect(result.formatted.hoursMonthly).toBe("6.7");
    expect(result.unbilledMonthly).toBeCloseTo(406.6667, 4);
    expect(result.formatted.unbilledMonthly).toBe("$407");
    expect(result.formatted.unbilledYearly).toBe("$4,880");
  });

  it("rounds 6.666… hours to 6.7 and 6.64 to 6.6", () => {
    expect(calculateCost(DEFAULT_INPUTS).formatted.hoursMonthly).toBe("6.7");
    expect(
      calculateCost({
        ...DEFAULT_INPUTS,
        sites: 1,
        changesPerSiteMonthly: 1,
        minutesPerChange: 100,
      }).formatted.hoursMonthly,
    ).toBe("1.7");
  });

  it("keeps the 0.5 step of changes per site", () => {
    const result = calculateCost({
      ...DEFAULT_INPUTS,
      changesPerSiteMonthly: 2.5,
    });

    expect(result.inputs.changesPerSiteMonthly).toBe(2.5);
    expect(result.changesMonthly).toBe(25);
    expect(result.formula).toContain("2.5 changes a month");
  });
});

describe("currency", () => {
  it.each([
    ["EUR", "€4,800"],
    ["GBP", "£4,800"],
    ["USD", "$4,800"],
  ] as const)("formats %s as %s", (currency, expected) => {
    const result = calculateCost({ ...DEFAULT_INPUTS, currency });

    expect(result.formatted.unbilledYearly).toBe(expected);
  });

  it("falls back to USD for an unknown currency", () => {
    const result = calculateCost({
      ...DEFAULT_INPUTS,
      currency: "JPY" as never,
    });

    expect(result.inputs.currency).toBe("USD");
    expect(result.formatted.unbilledYearly).toBe("$4,800");
  });

  it("falls back to USD for a hostile currency string", () => {
    const result = calculateCost({
      ...DEFAULT_INPUTS,
      currency: "<script>alert(1)</script>" as never,
    });

    expect(result.inputs.currency).toBe("USD");
    expect(JSON.stringify(result)).not.toContain("<script");
  });

  it("offers exactly USD, EUR and GBP", () => {
    expect([...CURRENCIES]).toEqual(["USD", "EUR", "GBP"]);
  });
});

describe("clampInputs", () => {
  it("returns the defaults for an empty object", () => {
    expect(clampInputs({})).toEqual(DEFAULT_INPUTS);
  });

  it.each([
    ["sites", 0, 1],
    ["sites", 501, 500],
    ["sites", -3, 1],
    ["changesPerSiteMonthly", -1, 0],
    ["changesPerSiteMonthly", 51, 50],
    ["minutesPerChange", 0, 1],
    ["minutesPerChange", 241, 240],
    ["hourlyRate", -5, 0],
    ["hourlyRate", 10_001, 10_000],
    ["billedPercent", -1, 0],
    ["billedPercent", 101, 100],
  ] as const)("clamps %s=%s to %s", (field, value, expected) => {
    expect(clampInputs({ [field]: value })[field]).toBe(expected);
  });

  it.each([
    ["sites", 10],
    ["changesPerSiteMonthly", 2],
    ["minutesPerChange", 20],
    ["hourlyRate", 60],
    ["billedPercent", 0],
  ] as const)(
    "uses the default for NaN and Infinity in %s",
    (field, fallback) => {
      expect(clampInputs({ [field]: Number.NaN })[field]).toBe(fallback);
      expect(clampInputs({ [field]: Infinity })[field]).toBe(fallback);
      expect(clampInputs({ [field]: -Infinity })[field]).toBe(fallback);
      expect(clampInputs({ [field]: undefined })[field]).toBe(fallback);
      expect(clampInputs({ [field]: null })[field]).toBe(fallback);
      expect(clampInputs({ [field]: "" })[field]).toBe(fallback);
      expect(clampInputs({ [field]: "abc" })[field]).toBe(fallback);
      expect(clampInputs({ [field]: {} })[field]).toBe(fallback);
    },
  );

  it("reads numeric strings", () => {
    expect(clampInputs({ sites: "12", hourlyRate: " 75 " })).toMatchObject({
      sites: 12,
      hourlyRate: 75,
    });
  });

  it("clamps an absurdly large number rather than rejecting it", () => {
    expect(clampInputs({ sites: 1e9 }).sites).toBe(500);
    expect(clampInputs({ sites: "1e9" }).sites).toBe(500);
  });

  it("rounds whole-number fields and snaps changes to the 0.5 step", () => {
    expect(clampInputs({ sites: 3.6 }).sites).toBe(4);
    expect(clampInputs({ minutesPerChange: 19.4 }).minutesPerChange).toBe(19);
    expect(
      clampInputs({ changesPerSiteMonthly: 2.3 }).changesPerSiteMonthly,
    ).toBe(2.5);
    expect(
      clampInputs({ changesPerSiteMonthly: 2.2 }).changesPerSiteMonthly,
    ).toBe(2);
  });

  it("ignores fields it does not know", () => {
    const clamped = clampInputs({
      sites: 5,
      __proto__: { polluted: true },
      extra: 1,
    } as never);

    expect(clamped).toEqual({ ...DEFAULT_INPUTS, sites: 5 });
    expect(Object.keys(clamped).sort()).toEqual(
      Object.keys(DEFAULT_INPUTS).sort(),
    );
  });
});

describe("describeFieldIssue", () => {
  it("is silent for a value in range", () => {
    expect(describeFieldIssue("sites", "12")).toBeNull();
    expect(describeFieldIssue("changesPerSiteMonthly", "0")).toBeNull();
    expect(describeFieldIssue("billedPercent", "100")).toBeNull();
  });

  it("names the range for a value out of range, empty or not a number", () => {
    expect(describeFieldIssue("sites", "501")).toBe("Between 1 and 500");
    expect(describeFieldIssue("sites", "0")).toBe("Between 1 and 500");
    expect(describeFieldIssue("sites", "")).toBe("Between 1 and 500");
    expect(describeFieldIssue("sites", "abc")).toBe("Between 1 and 500");
    expect(describeFieldIssue("hourlyRate", "-1")).toBe("Between 0 and 10,000");
    expect(describeFieldIssue("billedPercent", "101")).toBe(
      "Between 0 and 100",
    );
  });

  it("covers every numeric field with a limit", () => {
    expect(Object.keys(INPUT_LIMITS).sort()).toEqual([
      "billedPercent",
      "changesPerSiteMonthly",
      "hourlyRate",
      "minutesPerChange",
      "sites",
    ]);
  });
});

describe("cents in the hourly rate", () => {
  it("keeps the rate to the cent instead of snapping to a whole unit", () => {
    expect(clampInputs({ hourlyRate: 59.5 }).hourlyRate).toBe(59.5);
    expect(clampInputs({ hourlyRate: "59.55" }).hourlyRate).toBe(59.55);
    expect(clampInputs({ hourlyRate: 59.556 }).hourlyRate).toBe(59.56);
    expect(clampInputs({ hourlyRate: 0.1 + 0.2 }).hourlyRate).toBe(0.3);
  });

  it("shows cents in the rate and the formula only when there are any", () => {
    const cents = calculateCost({ ...DEFAULT_INPUTS, hourlyRate: 59.5 });
    expect(cents.formatted.hourlyRate).toBe("$59.50");
    expect(cents.formula).toContain("At $59.50 an hour");
    expect(calculateCost(DEFAULT_INPUTS).formatted.hourlyRate).toBe("$60");
  });
});

describe("describeFieldRounding", () => {
  it("is silent for a value that is already on its step", () => {
    expect(describeFieldRounding("sites", "12")).toBeNull();
    expect(describeFieldRounding("changesPerSiteMonthly", "2.5")).toBeNull();
    expect(describeFieldRounding("hourlyRate", "59.5")).toBeNull();
    expect(describeFieldRounding("hourlyRate", "59.55")).toBeNull();
  });

  it("names the value an off-step number becomes", () => {
    expect(describeFieldRounding("sites", "2.3")).toBe("Rounded to 2");
    expect(describeFieldRounding("minutesPerChange", "19.6")).toBe(
      "Rounded to 20",
    );
    expect(describeFieldRounding("changesPerSiteMonthly", "0.2")).toBe(
      "Rounded to 0",
    );
    expect(describeFieldRounding("changesPerSiteMonthly", "2.3")).toBe(
      "Rounded to 2.5",
    );
    expect(describeFieldRounding("hourlyRate", "59.556")).toBe(
      "Rounded to 59.56",
    );
  });

  it("leaves out-of-range, empty and non-numeric text to describeFieldIssue", () => {
    expect(describeFieldRounding("sites", "999.5")).toBeNull();
    expect(describeFieldRounding("sites", "")).toBeNull();
    expect(describeFieldRounding("sites", "abc")).toBeNull();
  });
});
