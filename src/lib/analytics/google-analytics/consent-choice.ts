export type ConsentChoice = "granted" | "denied";

/** The visitor's choice. First-party, this host only, read by our own code. */
export const CONSENT_COOKIE_NAME = "rcf_analytics_consent";

/** Six months (180 days): long enough not to nag, short enough to re-ask. */
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** `document.cookie` value that records a choice. */
export function serializeConsentCookie(
  choice: ConsentChoice,
  {
    isSecure,
    maxAgeSeconds = CONSENT_COOKIE_MAX_AGE_SECONDS,
  }: { isSecure: boolean; maxAgeSeconds?: number },
): string {
  const attributes = [
    `${CONSENT_COOKIE_NAME}=${choice}`,
    `Max-Age=${maxAgeSeconds}`,
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
