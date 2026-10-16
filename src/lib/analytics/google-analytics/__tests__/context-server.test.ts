import { issueConsentReceipt } from "../consent-receipt";
/** @jest-environment node */
import {
  contextConsent,
  bindAnalyticsContext,
  CONTEXT_COOKIE_NAME,
} from "../context-server";
const rpc = jest.fn();
beforeEach(() => {
  process.env.ANALYTICS_CONSENT_SIGNING_KEY = "ab".repeat(32);
});
afterEach(() => {
  delete process.env.ANALYTICS_CONSENT_SIGNING_KEY;
});
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ rpc }),
}));
const req = (cookie = "", country?: string) =>
  new Request("https://www.recopyfa.st/auth/callback", {
    headers: { cookie, ...(country ? { "x-vercel-ip-country": country } : {}) },
  });
it("default grant requires trusted settled edge geography; denial always wins", () => {
  expect(contextConsent(req())).toBeNull();
  expect(contextConsent(req("", "US"))?.basis).toBe("regional");
  expect(contextConsent(req("rcf_analytics_consent=denied", "US"))).toBeNull();
});
it("legacy explicit grant without known expiry fails closed; new choice expiry is capped", () => {
  expect(contextConsent(req("rcf_analytics_consent=granted"))).toBeNull();
  const at = Date.now() - 179 * 86400000;
  const proof = issueConsentReceipt(at)!;
  const consent = contextConsent(
    req(
      `rcf_analytics_consent=granted; __Host-rcf_analytics_consent=${proof.value}`,
    ),
  );
  expect(consent?.expiresAt).toBe(at + 180 * 86400000);
});
it("verified binding catches DB failure and never blocks authentication", async () => {
  rpc.mockReturnValue({
    abortSignal: () => Promise.reject(new Error("private failure")),
  });
  await expect(
    bindAnalyticsContext(
      req(`${CONTEXT_COOKIE_NAME}=${"a".repeat(43)}`, "US"),
      "00000000-0000-4000-8000-000000000001",
    ),
  ).resolves.toBeUndefined();
  expect(rpc).toHaveBeenCalledWith(
    "bind_analytics_context",
    expect.objectContaining({
      p_user_id: "00000000-0000-4000-8000-000000000001",
    }),
  );
});

it("server logout erases only the presented capability and reports failure for retry", async () => {
  const { revokeAnalyticsCapability } = await import("../context-server");
  rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ error: null }) });
  await expect(
    revokeAnalyticsCapability(req(`${CONTEXT_COOKIE_NAME}=${"a".repeat(43)}`)),
  ).resolves.toBe(true);
  expect(rpc).toHaveBeenCalledWith(
    "revoke_analytics_context",
    expect.objectContaining({ p_user_id: null }),
  );
  rpc.mockReturnValue({
    abortSignal: () => Promise.resolve({ error: { message: "unavailable" } }),
  });
  await expect(
    revokeAnalyticsCapability(req(`${CONTEXT_COOKIE_NAME}=${"a".repeat(43)}`)),
  ).resolves.toBe(false);
});
