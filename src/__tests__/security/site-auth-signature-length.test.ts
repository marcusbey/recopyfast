/**
 * A wrong-LENGTH signature must be a refusal, not a crash.
 *
 * `crypto.timingSafeEqual` throws `RangeError: Input buffers must have the same
 * byte length` when the two buffers differ in size — it compares in constant
 * time, it does not tolerate mismatched lengths. `verifySiteTokenSignature`
 * called it bare, so a token whose third part is any length but 64 hex chars
 * threw out of the verifier, out of `authorizeSiteRequest`, and into the route's
 * `catch (authError)` — which returns `authError.message` verbatim to an
 * unauthenticated caller (api/content/[siteId]/route.ts:296-308).
 *
 * `server/auth.js:73-77` already gets this right on the realtime side. This is
 * the same guard on the HTTP side, so the two copies agree — the drift they are
 * watched for in src/__tests__/websocket/auth-parity.test.ts.
 */

import {
  buildSiteToken,
  verifySiteTokenSignature,
  authorizeSiteRequest,
} from "@/lib/security/site-auth";

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: {
        id: "site-123",
        domain: "customer.example",
        api_key: "test-api-key",
      },
      error: null,
    }),
  })),
}));

const SITE_ID = "site-123";
const API_KEY = "test-api-key";

/** A structurally valid token whose signature is the wrong length. */
function tokenWithSignature(signature: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return `${SITE_ID}.${issuedAt}.${signature}`;
}

describe("verifySiteTokenSignature with a mis-sized signature", () => {
  it("accepts the real thing", () => {
    // The control: the guard below refuses length, not everything.
    expect(
      verifySiteTokenSignature(
        SITE_ID,
        API_KEY,
        buildSiteToken(SITE_ID, API_KEY),
      ),
    ).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["one character", "a"],
    ["short hex", "deadbeef"],
    ["63 chars — one short of a digest", "a".repeat(63)],
    ["65 chars — one long", "a".repeat(65)],
    ["absurdly long", "a".repeat(5000)],
  ])("refuses a %s signature without throwing", (_label, signature) => {
    expect(
      verifySiteTokenSignature(SITE_ID, API_KEY, tokenWithSignature(signature)),
    ).toBe(false);
  });

  it("gives an unauthenticated caller nothing but the generic refusal", async () => {
    // The message matters: the route hands `authError.message` straight back.
    // "Input buffers must have the same byte length" is an internal detail, and
    // an exception reaching a route's catch is not a decision the route made.
    await expect(
      authorizeSiteRequest({
        siteId: SITE_ID,
        token: tokenWithSignature("deadbeef"),
        origin: "https://customer.example",
      }),
    ).rejects.toThrow("Invalid site token");
  });
});
