import { DEFAULT_INPUTS } from "../calculate";
import { parseParams, serializeParams } from "../params";

describe("parseParams", () => {
  it("returns the defaults for no parameters", () => {
    expect(parseParams(new URLSearchParams())).toEqual(DEFAULT_INPUTS);
  });

  it("round-trips through serializeParams", () => {
    const inputs = {
      sites: 12,
      changesPerSiteMonthly: 3.5,
      minutesPerChange: 25,
      hourlyRate: 80,
      billedPercent: 40,
      currency: "EUR",
    } as const;

    expect(parseParams(new URLSearchParams(serializeParams(inputs)))).toEqual(
      inputs,
    );
  });

  it("reads the six documented keys", () => {
    const parsed = parseParams(
      new URLSearchParams(
        "sites=12&changes=3&minutes=20&rate=60&billed=10&currency=GBP",
      ),
    );

    expect(parsed).toEqual({
      sites: 12,
      changesPerSiteMonthly: 3,
      minutesPerChange: 20,
      hourlyRate: 60,
      billedPercent: 10,
      currency: "GBP",
    });
  });

  it("falls back to the defaults for junk and missing values", () => {
    expect(
      parseParams(new URLSearchParams("sites=abc&changes=&rate=")),
    ).toEqual(DEFAULT_INPUTS);
  });

  it("clamps rather than rejects", () => {
    const parsed = parseParams(
      new URLSearchParams("sites=1e9&rate=-5&currency=JPY&billed=900"),
    );

    expect(parsed.sites).toBe(500);
    expect(parsed.hourlyRate).toBe(0);
    expect(parsed.currency).toBe("USD");
    expect(parsed.billedPercent).toBe(100);
  });

  it("ignores prototype-shaped and extra keys without touching Object.prototype", () => {
    const parsed = parseParams(
      new URLSearchParams(
        "__proto__=x&constructor=y&prototype=z&utm_source=a&sites=7",
      ),
    );

    expect(parsed).toEqual({ ...DEFAULT_INPUTS, sites: 7 });
    expect(Object.keys(parsed).sort()).toEqual(
      Object.keys(DEFAULT_INPUTS).sort(),
    );
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "x")).toBe(
      false,
    );
  });

  it("accepts any reader with a get method", () => {
    const reader = {
      get: (name: string) => (name === "sites" ? "9" : null),
    };

    expect(parseParams(reader).sites).toBe(9);
  });
});

describe("serializeParams", () => {
  it("writes the six keys in a stable canonical order", () => {
    expect(serializeParams(DEFAULT_INPUTS)).toBe(
      "sites=10&changes=2&minutes=20&rate=60&billed=0&currency=USD",
    );
  });

  it("serialises the clamped value, never a raw one", () => {
    expect(
      serializeParams({
        ...DEFAULT_INPUTS,
        sites: 9999,
        currency: "XXX" as never,
      }),
    ).toBe("sites=500&changes=2&minutes=20&rate=60&billed=0&currency=USD");
  });
});
