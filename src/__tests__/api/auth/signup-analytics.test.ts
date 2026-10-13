/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET as confirm } from "@/app/auth/confirm/route";
import { GET as callback } from "@/app/auth/callback/route";
const getUser = jest.fn(),
  verifyOtp = jest.fn(),
  exchangeCodeForSession = jest.fn(),
  freeze = jest.fn(),
  bind = jest.fn(),
  trial = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser, verifyOtp, exchangeCodeForSession },
  }),
}));
jest.mock("@/lib/analytics/google-analytics/conversions", () => ({
  freezeVerifiedSignup: (...a: unknown[]) => freeze(...a),
}));
jest.mock("@/lib/analytics/google-analytics/context-server", () => ({
  bindAnalyticsContext: (...a: unknown[]) => bind(...a),
}));
jest.mock("@/lib/billing/trial", () => ({
  ensureTrialStarted: (...a: unknown[]) => trial(...a),
}));
jest.mock("@/app/auth/public-origin", () => ({
  resolvePublicOrigin: () => "https://www.recopyfa.st",
}));
beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({
    data: { user: { id: "verified" } },
    error: null,
  });
  verifyOtp.mockResolvedValue({ error: null });
  exchangeCodeForSession.mockResolvedValue({ error: null });
  freeze.mockResolvedValue({ state: "pending" });
});
test.each(["signup", "invite", "magiclink", "email", "email_change"])(
  "%s confirmation freezes with actual verified proof type",
  async (type) => {
    const response = await confirm(
      new NextRequest(
        `https://www.recopyfa.st/auth/confirm?type=${type}&token_hash=dummy`,
      ),
    );
    expect(response.status).toBe(307);
    expect(freeze).toHaveBeenCalledWith(expect.anything(), "verified", type);
    expect(bind).not.toHaveBeenCalled();
    expect(trial).toHaveBeenCalled();
  },
);
test("PKCE success records unproven disposition; no-code existing session does not freeze", async () => {
  await callback(
    new Request("https://www.recopyfa.st/auth/callback?code=dummy"),
  );
  expect(freeze).toHaveBeenCalledWith(expect.anything(), "verified", "pkce");
  freeze.mockClear();
  await callback(new Request("https://www.recopyfa.st/auth/callback"));
  expect(freeze).not.toHaveBeenCalled();
  expect(bind).toHaveBeenCalled();
});
test("rejected OTP and rejected verified-user lookup never freeze", async () => {
  verifyOtp.mockResolvedValue({ error: { message: "dummy" } });
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  await confirm(
    new NextRequest(
      "https://www.recopyfa.st/auth/confirm?type=signup&token_hash=dummy",
    ),
  );
  expect(freeze).not.toHaveBeenCalled();
  verifyOtp.mockResolvedValue({ error: null });
  getUser.mockResolvedValue({
    data: { user: { id: "untrusted" } },
    error: new Error("dummy"),
  });
  await confirm(
    new NextRequest(
      "https://www.recopyfa.st/auth/confirm?type=signup&token_hash=dummy",
    ),
  );
  expect(freeze).not.toHaveBeenCalled();
  spy.mockRestore();
});
test("analytics unknown leaves authentication and trial success unchanged", async () => {
  freeze.mockResolvedValue({ state: "unknown" });
  const response = await confirm(
    new NextRequest(
      "https://www.recopyfa.st/auth/confirm?type=signup&token_hash=dummy",
    ),
  );
  expect(response.status).toBe(307);
  expect(trial).toHaveBeenCalledWith(expect.anything(), "verified");
});
