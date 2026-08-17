/**
 * GET /auth/confirm — the cross-device sibling of /auth/callback, and the
 * second (and last) place the server sees a session established.
 *
 * It exists because the PKCE exchange needs a code-verifier cookie the phone
 * does not have when the link was requested on a laptop. Both routes therefore
 * have to start the trial, or an entire class of customer — everyone who opens
 * the email somewhere else — never gets one.
 */

const mockGetUser = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: { verifyOtp: mockVerifyOtp, getUser: mockGetUser },
    }),
  ),
}));

jest.mock("@/lib/billing/trial", () => ({
  ensureTrialStarted: jest.fn(),
}));

import { GET } from "@/app/auth/confirm/route";
import { ensureTrialStarted } from "@/lib/billing/trial";
import type { NextRequest } from "next/server";

const asMock = (fn: unknown) => fn as jest.Mock;

const ORIGIN = "https://recopyfast.test";

function request(url: string): NextRequest {
  return new Request(url, {
    headers: { host: "recopyfast.test" },
  }) as unknown as NextRequest;
}

function destination(response: Response): string {
  const location = response.headers.get("location");
  return location === null ? "" : new URL(location).pathname;
}

const CONFIRM = `${ORIGIN}/auth/confirm?token_hash=hash&type=magiclink`;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockVerifyOtp.mockResolvedValue({ error: null });
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  asMock(ensureTrialStarted).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /auth/confirm", () => {
  it("starts a trial for the account that just confirmed", async () => {
    const response = await GET(request(CONFIRM));

    expect(ensureTrialStarted).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
    );
    expect(destination(response)).toBe("/dashboard");
  });

  it("does not change where the user lands", async () => {
    const response = await GET(request(`${CONFIRM}&next=%2Fdashboard%2Fsites`));

    expect(destination(response)).toBe("/dashboard/sites");
  });

  it("confirms the sign-in anyway when the trial grant throws", async () => {
    asMock(ensureTrialStarted).mockRejectedValue(new Error("supabase down"));

    const response = await GET(request(CONFIRM));

    expect(destination(response)).toBe("/dashboard");
  });

  it("attempts nothing when the token could not be verified", async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: "expired" } });

    const response = await GET(request(CONFIRM));

    expect(ensureTrialStarted).not.toHaveBeenCalled();
    expect(destination(response)).toBe("/auth/error");
  });

  it("attempts nothing for a link with no token at all", async () => {
    const response = await GET(
      request(`${ORIGIN}/auth/confirm?type=magiclink`),
    );

    expect(ensureTrialStarted).not.toHaveBeenCalled();
    expect(destination(response)).toBe("/auth/error");
  });
});
