import { createHmac, timingSafeEqual } from "node:crypto";
import { CONSENT_COOKIE_MAX_AGE_SECONDS } from "./consent";

export const CONSENT_RECEIPT_COOKIE_NAME = "__Host-rcf_analytics_consent";
const PURPOSE = "recopyfast:analytics-consent:v1";
const MAX_AGE_MS = CONSENT_COOKIE_MAX_AGE_SECONDS * 1000;
function signingKey(): Buffer | null {
  const value = process.env.ANALYTICS_CONSENT_SIGNING_KEY;
  return value && /^[a-fA-F0-9]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : null;
}
function signature(key: Buffer, issuedAt: number, expiresAt: number): string {
  return createHmac("sha256", key)
    .update(`${PURPOSE}:${issuedAt}:${expiresAt}`)
    .digest("base64url");
}
/** Server issuance/expiry integrity, not cryptographic proof of a human click. */
export function issueConsentReceipt(
  now = Date.now(),
): { value: string; issuedAt: number; expiresAt: number } | null {
  const key = signingKey();
  if (!key || !Number.isSafeInteger(now)) return null;
  const expiresAt = now + MAX_AGE_MS;
  return {
    value: `v1.${now}.${expiresAt}.${signature(key, now, expiresAt)}`,
    issuedAt: now,
    expiresAt,
  };
}
export function verifyConsentReceipt(
  value: string | null,
  now = Date.now(),
): { issuedAt: number; expiresAt: number } | null {
  const key = signingKey();
  if (!key || !value) return null;
  const match = /^v1\.(\d{13})\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return null;
  const issuedAt = Number(match[1]),
    expiresAt = Number(match[2]);
  if (issuedAt > now || expiresAt <= now || expiresAt - issuedAt !== MAX_AGE_MS)
    return null;
  const expected = signature(key, issuedAt, expiresAt);
  if (!timingSafeEqual(Buffer.from(match[3]), Buffer.from(expected)))
    return null;
  return { issuedAt, expiresAt };
}
