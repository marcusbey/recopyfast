/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET as confirm } from "@/app/auth/confirm/route";
import { GET as callback } from "@/app/auth/callback/route";
const getUser = jest.fn(),
  verifyOtp = jest.fn(),
  exchangeCodeForSession = jest.fn(),
  bindAnalyticsContext = jest.fn();
const freezeVerifiedSignup = jest.fn();
jest.mock("@/lib/analytics/google-analytics/conversions", () => ({
  freezeVerifiedSignup: (...args: unknown[]) => freezeVerifiedSignup(...args),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser, verifyOtp, exchangeCodeForSession },
  }),
}));
jest.mock("@/lib/analytics/google-analytics/context-server", () => ({
  bindAnalyticsContext: (...args: unknown[]) => bindAnalyticsContext(...args),
}));
jest.mock("@/lib/billing/trial", () => ({ ensureTrialStarted: jest.fn() }));
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
  bindAnalyticsContext.mockResolvedValue(undefined);
});
it.each([
  ["confirm", confirm, "token_hash=test&type=magiclink"],
  ["callback", callback, "code=test"],
] as const)(
  "%s binds only verified account after establishment",
  async (_name, handler, query) => {
    const response = await handler(
      new NextRequest(`https://www.recopyfa.st/auth/confirm?${query}`),
    );
    expect(response.status).toBe(307);
    expect(freezeVerifiedSignup).toHaveBeenCalledWith(
      expect.anything(),
      "verified",
      _name === "confirm" ? "magiclink" : "pkce",
    );
    getUser.mockResolvedValue({
      data: { user: { id: "untrusted" } },
      error: new Error("rejected"),
    });
    freezeVerifiedSignup.mockClear();
    await handler(
      new NextRequest(`https://www.recopyfa.st/auth/confirm?${query}`),
    );
    expect(freezeVerifiedSignup).not.toHaveBeenCalled();
  },
);
