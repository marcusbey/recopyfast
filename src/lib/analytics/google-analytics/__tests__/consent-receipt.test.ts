/** @jest-environment node */
import { issueConsentReceipt, verifyConsentReceipt } from "../consent-receipt";
const NOW = Date.parse("2026-10-12T20:00:00Z");
beforeEach(() => {
  process.env.ANALYTICS_CONSENT_SIGNING_KEY = "ab".repeat(32);
});
afterEach(() => {
  delete process.env.ANALYTICS_CONSENT_SIGNING_KEY;
});
it("records server issuance and exactly180-day expiry with no visitor/account identity", () => {
  const receipt = issueConsentReceipt(NOW)!;
  expect(verifyConsentReceipt(receipt.value, NOW)).toEqual({
    issuedAt: NOW,
    expiresAt: NOW + 180 * 86400000,
  });
  expect(verifyConsentReceipt(receipt.value, NOW + 180 * 86400000)).toBeNull();
  expect(verifyConsentReceipt(receipt.value, NOW - 1)).toBeNull();
});
it("rejects tamper, wrong version, wrong key and malformed proof", () => {
  const { value } = issueConsentReceipt(NOW)!;
  for (const altered of [
    value.replace("v1.", "v2."),
    value.replace(String(NOW), String(NOW - 1)),
    value + "x",
    "garbage",
  ])
    expect(verifyConsentReceipt(altered, NOW)).toBeNull();
  process.env.ANALYTICS_CONSENT_SIGNING_KEY = "cd".repeat(32);
  expect(verifyConsentReceipt(value, NOW)).toBeNull();
});
it.each(["", "short", "z".repeat(64)])(
  "fails closed on invalid signing key %s",
  (key) => {
    process.env.ANALYTICS_CONSENT_SIGNING_KEY = key;
    expect(issueConsentReceipt(NOW)).toBeNull();
    expect(verifyConsentReceipt("v1.1.2.fake", NOW)).toBeNull();
  },
);
