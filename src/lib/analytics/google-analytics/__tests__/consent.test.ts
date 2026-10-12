/**
 * @jest-environment node
 */

/**
 * s107 — Consent Mode v2 defaults, by region, and the visitor's stored choice.
 *
 * Privacy-first, and fail-closed: a missing or malformed country hint is
 * treated as "consent required", so a request that did not come through
 * Vercel's edge (local, CI, any other host) behaves as an EEA visit. Ads are
 * denied for everyone, always — RecopyFast runs no ads.
 */

import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  CONSENT_REQUIRED_REGIONS,
  CONSENT_REQUIRED_SUBDIVISIONS,
  consentDefaults,
  isConsentRequiredCountry,
  readConsentChoice,
  serializeConsentCookie,
} from "@/lib/analytics/google-analytics/consent";

const EU_27 = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
];
const EEA_NOT_EU = ["IS", "LI", "NO"];

describe("the consent-required region list", () => {
  it("covers the whole EEA, the UK and Switzerland", () => {
    for (const code of [...EU_27, ...EEA_NOT_EU, "GB", "CH"]) {
      expect([code, CONSENT_REQUIRED_REGIONS.includes(code)]).toEqual([
        code,
        true,
      ]);
    }
  });

  it("covers the EU's outermost regions that geolocate under their own code", () => {
    for (const code of ["AX", "GF", "GP", "MF", "MQ", "RE", "YT"]) {
      expect(CONSENT_REQUIRED_REGIONS).toContain(code);
    }
  });

  it("uses ISO 3166-1 alpha-2 codes, Greece as GR (not the EU's EL), no duplicates", () => {
    for (const code of CONSENT_REQUIRED_REGIONS) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
    expect(CONSENT_REQUIRED_REGIONS).not.toContain("EL");
    expect(CONSENT_REQUIRED_REGIONS).not.toContain("UK");
    expect(new Set(CONSENT_REQUIRED_REGIONS).size).toBe(
      CONSENT_REQUIRED_REGIONS.length,
    );
  });

  it("does not sweep in the rest of the world", () => {
    for (const code of ["US", "CA", "BR", "IN", "JP", "AU", "TR", "RU"]) {
      expect(CONSENT_REQUIRED_REGIONS).not.toContain(code);
    }
  });
});

describe("isConsentRequiredCountry", () => {
  it.each(["FR", "DE", "GB", "CH", "NO", "fr", " de "])(
    "is true for %j",
    (country) => {
      expect(isConsentRequiredCountry(country)).toBe(true);
    },
  );

  // Canada depends on the province: see "in Canada, by province" below.
  it.each(["US", "BR", "JP"])("is false for %s", (country) => {
    expect(isConsentRequiredCountry(country)).toBe(false);
  });

  it.each([null, undefined, "", "X", "USA", "1A", "F R", "<script>"])(
    "fails closed on a missing or malformed hint: %j",
    (country) => {
      expect(isConsentRequiredCountry(country)).toBe(true);
    },
  );

  /**
   * Independent review F3: two letters are not a country. GeoIP sources
   * answer "unknown" (XX, ZZ), Tor (T1), anonymous proxy or satellite (A1,
   * A2), "other" (O1) and the legacy continent codes EU and AP. Only an
   * officially assigned ISO 3166-1 code can mean "no consent needed".
   */
  it.each(["XX", "ZZ", "T1", "EU", "AP", "A1", "A2", "O1", "QO", "AA", "XA"])(
    "fails closed on a placeholder or unassigned code: %s",
    (country) => {
      expect(isConsentRequiredCountry(country)).toBe(true);
    },
  );

  it.each(["US", "AU", "IN", "MX", "ZA", "SG", "NZ", "AE", "TW", "HK"])(
    "is false for the assigned country %s",
    (country) => {
      expect(isConsentRequiredCountry(country)).toBe(false);
    },
  );

  /**
   * Quebec's Law 25 (owner decision on the review, 2026-10-12): Quebec asks
   * first, like the EEA. Vercel sends the province as
   * `x-vercel-ip-country-region`, the ISO 3166-2 code without its country
   * prefix. A Canadian request whose province is missing or unknown cannot be
   * told apart from Quebec, so it asks too.
   */
  describe("in Canada, by province", () => {
    it.each(["QC", "qc", " QC "])("is true for Quebec (%j)", (region) => {
      expect(isConsentRequiredCountry("CA", region)).toBe(true);
    });

    it.each([
      "ON",
      "BC",
      "AB",
      "MB",
      "NB",
      "NL",
      "NS",
      "NT",
      "NU",
      "PE",
      "SK",
      "YT",
    ])("is false for %s", (region) => {
      expect(isConsentRequiredCountry("CA", region)).toBe(false);
    });

    it.each([null, undefined, "", "Q", "XX", "QUE", "<script>"])(
      "fails closed on a missing or unknown province: %j",
      (region) => {
        expect(isConsentRequiredCountry("CA", region)).toBe(true);
      },
    );

    it("does not apply a province outside Canada", () => {
      expect(isConsentRequiredCountry("US", "QC")).toBe(false);
      expect(isConsentRequiredCountry("FR", "ON")).toBe(true);
    });
  });
});

describe("consentDefaults", () => {
  const DENIED_EVERYTHING = {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  };

  it("denies everything in the consent regions, by Google's own region match", () => {
    const [regional] = consentDefaults({ consentRequired: false });

    expect(regional).toEqual({
      ...DENIED_EVERYTHING,
      region: [...CONSENT_REQUIRED_REGIONS, ...CONSENT_REQUIRED_SUBDIVISIONS],
    });
  });

  it("names Quebec to Google as the ISO 3166-2 subdivision CA-QC, not all of Canada", () => {
    const [regional] = consentDefaults({ consentRequired: false });

    expect(CONSENT_REQUIRED_SUBDIVISIONS).toEqual(["CA-QC"]);
    expect(regional.region).toContain("CA-QC");
    expect(regional.region).not.toContain("CA");
  });

  it("grants analytics elsewhere when the hint needs no consent, ads still denied", () => {
    const [, visitor] = consentDefaults({ consentRequired: false });

    expect(visitor).toEqual({
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted",
    });
    expect(visitor).not.toHaveProperty("region");
  });

  it("denies analytics for this visitor too when the hint says consent is required", () => {
    const [regional, visitor] = consentDefaults({ consentRequired: true });

    expect(regional.analytics_storage).toBe("denied");
    expect(visitor).toEqual(DENIED_EVERYTHING);
  });

  it("never grants an ad signal, whatever the hint", () => {
    for (const consentRequired of [true, false]) {
      for (const defaults of consentDefaults({ consentRequired })) {
        expect(defaults.ad_storage).toBe("denied");
        expect(defaults.ad_user_data).toBe("denied");
        expect(defaults.ad_personalization).toBe("denied");
      }
    }
  });
});

describe("the choice cookie", () => {
  it("lives six months, first-party, on every path", () => {
    expect(CONSENT_COOKIE_MAX_AGE_SECONDS).toBe(180 * 24 * 60 * 60);

    const cookie = serializeConsentCookie("granted", { isSecure: true });

    expect(cookie).toBe(
      `${CONSENT_COOKIE_NAME}=granted; Max-Age=15552000; Path=/; SameSite=Lax; Secure`,
    );
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("drops Secure on plain http (local builds), nothing else", () => {
    expect(serializeConsentCookie("denied", { isSecure: false })).toBe(
      `${CONSENT_COOKIE_NAME}=denied; Max-Age=15552000; Path=/; SameSite=Lax`,
    );
  });

  it.each([
    [`${CONSENT_COOKIE_NAME}=granted`, "granted"],
    [`a=1; ${CONSENT_COOKIE_NAME}=denied; b=2`, "denied"],
    [`a=1;${CONSENT_COOKIE_NAME}=granted`, "granted"],
  ] as const)("reads %j as %s", (cookieHeader, expected) => {
    expect(readConsentChoice(cookieHeader)).toBe(expected);
  });

  it.each([
    "",
    "a=1",
    `${CONSENT_COOKIE_NAME}=`,
    `${CONSENT_COOKIE_NAME}=yes`,
    `${CONSENT_COOKIE_NAME}=GRANTED`,
    `x${CONSENT_COOKIE_NAME}=granted`,
  ])("treats %j as no choice yet", (cookieHeader) => {
    expect(readConsentChoice(cookieHeader)).toBeNull();
  });
});
