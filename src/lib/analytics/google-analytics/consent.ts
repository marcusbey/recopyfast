/**
 * Consent Mode v2 for Google Analytics (s107, ADR 063).
 *
 * Privacy-first by construction:
 *
 * - Ads are denied for every visitor, everywhere. RecopyFast runs no ads, so
 *   there is no ad signal to grant; `ad_storage`, `ad_user_data` and
 *   `ad_personalization` are never anything but "denied" in this file.
 * - In the EEA, the UK, Switzerland and Quebec, analytics is denied until the
 *   visitor chooses "Allow analytics". Two layers say so: Google's own
 *   `region` match (the first default), and our hint from Vercel's edge (the
 *   second, the visitor's own default). Where the hint says consent is
 *   required, the component does not even request gtag.js before the choice.
 * - A missing, malformed or unknown hint FAILS CLOSED. Vercel always sends
 *   `x-vercel-ip-country` in production; its absence means local, CI or some
 *   other host, and none of those may be treated as "no consent needed". Nor
 *   may a code that is not a country: GeoIP placeholders (XX, ZZ, T1, A1, A2,
 *   O1, EU, AP) and anything else outside ISO 3166-1's assigned codes
 *   (independent review F3). A Canadian request without a known province
 *   cannot be told apart from Quebec, so it asks too.
 *
 * The country and province are read per request by `/analytics/gtag-init.js`
 * and reduced to one boolean there. They are never stored, logged or written
 * into a response.
 */

// Lightweight first-party cookie controls stay independent of the geography
// catalog so root authentication does not load the deferred Google runtime.
export {
  readConsentChoice,
  serializeConsentCookie,
  CONSENT_COOKIE_NAME,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
} from "./consent-choice";
export type { ConsentChoice } from "./consent-choice";
type ConsentState = "granted" | "denied";

/**
 * Where analytics needs the visitor's consent first.
 *
 * EU 27 + the EEA's Iceland, Liechtenstein and Norway + the UK + Switzerland,
 * as ISO 3166-1 alpha-2 (Greece is GR here, not the EU's own "EL"; the UK is
 * GB). Plus the EU's outermost regions that IP geolocation reports under their
 * own code — Åland, French Guiana, Guadeloupe, Saint Martin, Martinique,
 * Réunion and Mayotte are EU territory, and a visitor there is no less in the
 * EU for having a different country code. Google's `region` parameter takes
 * these codes as-is.
 */
export const CONSENT_REQUIRED_REGIONS: readonly string[] = Object.freeze([
  // European Union
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
  // EU outermost regions and Åland, under their own ISO codes
  "AX",
  "GF",
  "GP",
  "MF",
  "MQ",
  "RE",
  "YT",
  // European Economic Area outside the EU
  "IS",
  "LI",
  "NO",
  // United Kingdom and Switzerland
  "GB",
  "CH",
]);

/**
 * Subdivisions where analytics needs consent first, as ISO 3166-2 codes —
 * the form Google's `region` parameter takes. Quebec: Law 25 (owner decision
 * on the s107 independent review, 2026-10-12). Not the rest of Canada.
 */
export const CONSENT_REQUIRED_SUBDIVISIONS: readonly string[] = Object.freeze([
  "CA-QC",
]);

const REGION_SET = new Set(CONSENT_REQUIRED_REGIONS);

/**
 * ISO 3166-1 alpha-2, the 249 officially assigned codes (checked against
 * CLDR's region names). Anything else — user-assigned (AA, QM–QZ, XA–XZ, ZZ),
 * exceptionally or transitionally reserved (EU, UK, EA, IC, FX, AN, …), or a
 * GeoIP vendor's own (T1, A1, A2, O1, AP) — is not a country we can place.
 */
const ASSIGNED_COUNTRIES = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
    "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
    "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY " +
    "HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY " +
    "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
    "NA NC NE NF NG NI NL NO NP NR NU NZ OM " +
    "PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
    "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ " +
    "VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

/** Canada's provinces and territories other than Quebec (ISO 3166-2:CA). */
const CANADA_WITHOUT_CONSENT = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "SK",
  "YT",
]);

/**
 * Does a visitor from this country (Vercel's `x-vercel-ip-country`) and, in
 * Canada, province (`x-vercel-ip-country-region`, ISO 3166-2 without the
 * country prefix) have to choose before analytics runs? True for a missing,
 * malformed or unknown value of either that matters.
 */
export function isConsentRequiredCountry(
  country: string | null | undefined,
  region?: string | null,
): boolean {
  const code = (country ?? "").trim().toUpperCase();
  if (!ASSIGNED_COUNTRIES.has(code)) return true;
  if (REGION_SET.has(code)) return true;
  if (code === "CA") {
    return !CANADA_WITHOUT_CONSENT.has((region ?? "").trim().toUpperCase());
  }
  return false;
}

export interface ConsentDefault {
  ad_storage: ConsentState;
  ad_user_data: ConsentState;
  ad_personalization: ConsentState;
  analytics_storage: ConsentState;
  region?: string[];
}

/**
 * The two `gtag('consent', 'default', …)` commands, in the order they are
 * queued: the regional default first (everything denied in the consent
 * regions, matched by Google), then this visitor's default (analytics granted
 * only when the hint says no consent is needed). A region-specific default
 * wins over the global one for visitors Google places in that region, so a
 * visitor the hint misplaces outside the EEA still starts denied there.
 */
export function consentDefaults({
  consentRequired,
}: {
  consentRequired: boolean;
}): [ConsentDefault, ConsentDefault] {
  const adsDenied = {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  } as const;
  return [
    {
      ...adsDenied,
      analytics_storage: "denied",
      region: [...CONSENT_REQUIRED_REGIONS, ...CONSENT_REQUIRED_SUBDIVISIONS],
    },
    {
      ...adsDenied,
      analytics_storage: consentRequired ? "denied" : "granted",
    },
  ];
}
