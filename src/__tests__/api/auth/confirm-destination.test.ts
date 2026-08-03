/**
 * GET /auth/confirm — where the user lands after a magic link.
 *
 * The Supabase email template was repointed here so magic links survive being
 * opened on a different device: the old `/auth/callback` needed a PKCE verifier
 * cookie that a phone opening a link requested on a laptop does not have.
 *
 * That template passes the destination as `redirect_to`, rendered from
 * `{{ .RedirectTo }}` as an absolute URL, while our own code passes `next` as a
 * relative path. The route read only `next`, so every cross-device sign-in
 * worked and then landed on the default — the destination dropped silently,
 * which is the same defect the register recorded once already for
 * `next` vs `redirectedFrom`.
 *
 * These pin both spellings and, more importantly, that widening the input did
 * not widen the open redirect.
 */

const mockVerifyOtp = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({ auth: { verifyOtp: mockVerifyOtp } }),
  ),
}));

jest.mock("@/app/auth/public-origin", () => ({
  resolvePublicOrigin: () => "https://www.recopyfa.st",
}));

import { GET } from "@/app/auth/confirm/route";
import { NextRequest } from "next/server";

const ORIGIN = "https://www.recopyfa.st";

async function confirm(query: string): Promise<string> {
  const response = await GET(
    new NextRequest(`${ORIGIN}/auth/confirm?${query}`),
  );
  return response.headers.get("location") ?? "";
}

const VALID = "token_hash=abc123&type=magiclink";

describe("GET /auth/confirm destination", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyOtp.mockResolvedValue({ error: null });
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it("honours an absolute same-origin redirect_to, which is what the template sends", async () => {
    const location = await confirm(
      `${VALID}&redirect_to=${encodeURIComponent(`${ORIGIN}/dashboard/sites`)}`,
    );
    expect(location).toBe(`${ORIGIN}/dashboard/sites`);
  });

  it("keeps the query and hash of that destination", async () => {
    const location = await confirm(
      `${VALID}&redirect_to=${encodeURIComponent(`${ORIGIN}/dashboard/sites?tab=embed#script`)}`,
    );
    expect(location).toBe(`${ORIGIN}/dashboard/sites?tab=embed#script`);
  });

  it("still honours a relative next, which our own code sends", async () => {
    const location = await confirm(`${VALID}&next=%2Fdashboard%2Fbilling`);
    expect(location).toBe(`${ORIGIN}/dashboard/billing`);
  });

  it("prefers next when both are present", async () => {
    const location = await confirm(
      `${VALID}&next=%2Fdashboard%2Fbilling&redirect_to=${encodeURIComponent(`${ORIGIN}/dashboard/sites`)}`,
    );
    expect(location).toBe(`${ORIGIN}/dashboard/billing`);
  });

  it("refuses a cross-origin redirect_to", async () => {
    // The whole risk of accepting an absolute URL. It must not become an open
    // redirect just because the value now arrives spelled differently.
    const location = await confirm(
      `${VALID}&redirect_to=${encodeURIComponent("https://evil.example/steal")}`,
    );
    expect(location).toBe(`${ORIGIN}/dashboard`);
  });

  it("refuses a protocol-relative redirect_to", async () => {
    const location = await confirm(
      `${VALID}&redirect_to=${encodeURIComponent("//evil.example/steal")}`,
    );
    expect(location).toBe(`${ORIGIN}/dashboard`);
  });

  it("keeps a malformed redirect_to on our own origin", async () => {
    // `://nonsense` is not unparseable — `new URL` resolves it against our
    // origin and yields a same-origin path. That is the property worth
    // asserting: garbage may produce a 404, but it may never produce a
    // redirect off this host.
    const location = await confirm(`${VALID}&redirect_to=%3A%2F%2Fnonsense`);
    expect(location.startsWith(`${ORIGIN}/`)).toBe(true);
  });

  it("falls back when neither is given", async () => {
    const location = await confirm(VALID);
    expect(location).toBe(`${ORIGIN}/dashboard`);
  });

  it("sends a failed verification to the error page, destination or not", async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const location = await confirm(
      `${VALID}&redirect_to=${encodeURIComponent(`${ORIGIN}/dashboard/sites`)}`,
    );
    expect(location).toBe(`${ORIGIN}/auth/error`);
  });

  it("accepts type=magiclink, which is what the template sends", async () => {
    await confirm(VALID);
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "abc123",
    });
  });
});
