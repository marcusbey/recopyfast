/**
 * @jest-environment node
 */

/**
 * s107 — the measurement id is the on/off switch for Google Analytics.
 *
 * It is set in Vercel for Production only, so preview deployments send
 * nothing. Anything that is not a GA4 id is "off": the value is interpolated
 * into a script URL, so it is validated, never trusted.
 */

import {
  getMeasurementId,
  parseMeasurementId,
} from "@/lib/analytics/google-analytics/measurement-id";

describe("parseMeasurementId", () => {
  it.each(["G-ABC1234567", "G-E2ETEST000", "G-1234"])(
    "accepts the GA4 id %s",
    (id) => {
      expect(parseMeasurementId(id)).toBe(id);
    },
  );

  it("trims surrounding whitespace (a pasted env value)", () => {
    expect(parseMeasurementId("  G-ABC1234567\n")).toBe("G-ABC1234567");
  });

  it.each([
    undefined,
    "",
    "   ",
    "UA-12345-1",
    "GTM-ABC123",
    "g-abc1234567",
    "G-",
    "G-ABC",
    "G-ABC1234567&foo=bar",
    'G-ABC1234567"><script>',
    "G-ABCDEFGHIJKLMNOPQRSTU",
  ])("treats %j as off", (raw) => {
    expect(parseMeasurementId(raw)).toBeNull();
  });
});

describe("getMeasurementId", () => {
  const saved = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = saved;
  });

  it("reads NEXT_PUBLIC_GA_MEASUREMENT_ID at call time", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-ABC1234567";
    expect(getMeasurementId()).toBe("G-ABC1234567");

    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    expect(getMeasurementId()).toBeNull();
  });
});
