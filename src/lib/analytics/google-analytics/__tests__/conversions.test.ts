/** @jest-environment node */
import { freezeVerifiedSignup } from "../conversions";
const rpc = jest.fn(),
  abortSignal = jest.fn(),
  hash = jest.fn(),
  consent = jest.fn();
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ rpc }),
}));
jest.mock("../context-server", () => ({
  contextCapabilityHash: (...a: unknown[]) => hash(...a),
  contextConsent: (...a: unknown[]) => consent(...a),
}));
const request = new Request("https://www.recopyfa.st/auth/confirm");
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ANALYTICS_CONTEXT_DISABLED;
  hash.mockReturnValue("a".repeat(64));
  consent.mockReturnValue({ basis: "regional" });
  rpc.mockReturnValue({ abortSignal });
  abortSignal.mockResolvedValue({
    data: [{ id: "source", state: "pending", reason: "eligible" }],
    error: null,
  });
});
test.each(["signup", "invite"] as const)(
  "verified %s passes actual browser proof atomically",
  async (proof) => {
    await freezeVerifiedSignup(request, "verified", proof);
    expect(rpc).toHaveBeenCalledWith("freeze_analytics_signup", {
      p_user_id: "verified",
      p_hash: "a".repeat(64),
      p_proven: true,
      p_consent: "eligible",
    });
  },
);
test.each(["email", "magiclink", "email_change", "pkce"] as const)(
  "%s is unproven even with eligible context",
  async (proof) => {
    await freezeVerifiedSignup(request, "verified", proof);
    expect(rpc.mock.calls[0][1].p_proven).toBe(false);
  },
);
test("disabled context capture still freezes absent source, preventing later retrospective attribution", async () => {
  process.env.ANALYTICS_CONTEXT_DISABLED = "1";
  await freezeVerifiedSignup(request, "verified", "signup");
  expect(rpc.mock.calls[0][1]).toMatchObject({
    p_hash: null,
    p_consent: "ineligible",
  });
});
test("denial is forwarded for atomic account revocation", async () => {
  await freezeVerifiedSignup(
    new Request(request, {
      headers: { cookie: "rcf_analytics_consent=denied" },
    }),
    "verified",
    "signup",
  );
  expect(rpc.mock.calls[0][1]).toMatchObject({
    p_consent: "denied",
    p_hash: "a".repeat(64),
  });
});
test("an unavailable consent receipt freezes absence, not a current account context search", async () => {
  consent.mockReturnValue(null);
  await freezeVerifiedSignup(request, "verified", "signup");
  expect(rpc.mock.calls[0][1].p_hash).toBeNull();
});
test("all persistence failure is explicit unknown and never changes successful authentication", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  abortSignal.mockRejectedValue(new Error("secret raw failure"));
  expect(await freezeVerifiedSignup(request, "verified", "signup")).toEqual({
    state: "unknown",
  });
  expect(warn).toHaveBeenCalledWith(
    "[analytics/signup] source freeze unavailable",
  );
  warn.mockRestore();
});
