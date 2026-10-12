/**
 * Consent Mode v2 for Google Analytics (s107, ADR 063).
 *
 * Privacy-first by construction:
 *
 * - Ads are denied for every visitor, everywhere. RecopyFast runs no ads, so
 *   there is no ad signal to grant; `ad_storage`, `ad_user_data` and
 *   `ad_personalization` are never anything but "denied" in this file.
 * - In the EEA, the UK and Switzerland, analytics is denied until the visitor
 *   chooses "Allow analytics". Two layers say so: Google's own `region` match
 *   (the first default), and our country hint from Vercel's edge (the second,
 *   the visitor's own default). Where the hint says consent is required, the
 *   component does not even request gtag.js before the choice.
 * - A missing or malformed hint FAILS CLOSED. Vercel always sends
 *   `x-vercel-ip-country` in production; its absence means local, CI or some
 *   other host, and none of those may be treated as "no consent needed".
 *
 * The country is read per request by `/analytics/gtag-init.js` and reduced to
 * one boolean there. It is never stored, logged or written into a response.
 */

export type ConsentChoice = "granted" | "denied";
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

const REGION_SET = new Set(CONSENT_REQUIRED_REGIONS);

/**
 * Does a visitor from this country (Vercel's `x-vercel-ip-country`) have to
 * choose before analytics runs? True for a missing or malformed value.
 */
export function isConsentRequiredCountry(
  country: string | null | undefined,
): boolean {
  const code = (country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return true;
  return REGION_SET.has(code);
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
      region: [...CONSENT_REQUIRED_REGIONS],
    },
    {
      ...adsDenied,
      analytics_storage: consentRequired ? "denied" : "granted",
    },
  ];
}

/** The visitor's choice. First-party, this host only, read by our own code. */
export const CONSENT_COOKIE_NAME = "rcf_analytics_consent";

/** Six months (180 days): long enough not to nag, short enough to re-ask. */
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** `document.cookie` value that records a choice. */
export function serializeConsentCookie(
  choice: ConsentChoice,
  { isSecure }: { isSecure: boolean },
): string {
  const attributes = [
    `${CONSENT_COOKIE_NAME}=${choice}`,
    `Max-Age=${CONSENT_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
  ];
  if (isSecure) attributes.push("Secure");
  return attributes.join("; ");
}

/** The stored choice in a `Cookie` header / `document.cookie`, or null. */
export function readConsentChoice(
  cookieHeader: string | null | undefined,
): ConsentChoice | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== CONSENT_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value === "granted" || value === "denied" ? value : null;
  }
  return null;
}
